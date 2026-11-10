import type { FieldSource, StudyPaper } from '@captiveorigins/onephylogeny-core'
import { AcquireError, type FetchLike } from './index.js'

/**
 * Paper lookup (roadmap stage 3): for a study known only by its GenBank title, find the published paper's DOI and
 * PubMed IDs in Crossref and Europe PMC, and the paper's open supplements. Every result is a proposal with its source
 * and how well the title matched; nothing is attached until a person approves it, and the approval records who and when.
 *
 * Both services are free and keyless. We keep to their published etiquette: one request at a time, at least a second
 * apart by default, a User-Agent naming this tool and its repository (no personal email), and no retries on refusal.
 */
export type LinkProposal = {
  service: 'crossref' | 'europepmc'
  title: string
  year?: number
  journal?: string
  doi?: string
  pmid?: string
  pmcid?: string
  /** Shared title words over all title words (0–1), and whether the titles are the same after normalising. */
  titleMatch: number
  exactTitle: boolean
  /** Europe PMC's list of a paper's supplementary files, for open-access papers with a PMC ID. A link, not a download. */
  supplementsUrl?: string
  source: FieldSource
}

export type ApprovedLink = Pick<LinkProposal, 'doi' | 'pmid'> & { source: FieldSource & { approvedBy?: string; approvedAt: string } }

const CROSSREF = 'https://api.crossref.org/works'
const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest'
export const LOOKUP_USER_AGENT = 'OnePhylogeny (https://github.com/CaptiveOrigins/onephylogeny)'

const words = (t: string) => new Set(t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean))
export function titleMatch(a: string, b: string): { score: number; exact: boolean } {
  const x = words(a)
  const y = words(b)
  const shared = [...x].filter((w) => y.has(w)).length
  const all = new Set([...x, ...y]).size
  return { score: all ? Math.round((shared / all) * 1000) / 1000 : 0, exact: all > 0 && shared === all }
}

/** Sends requests one at a time, at least `gapMs` apart. */
export function paced(fetch: FetchLike, gapMs = 1000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = () => Date.now()): FetchLike {
  let last = -Infinity
  let queue = Promise.resolve()
  return (url, init) => {
    const run = queue.then(async () => {
      const wait = last + gapMs - now()
      if (wait > 0) await sleep(wait)
      last = now()
      return fetch(url, { ...init, headers: { 'User-Agent': LOOKUP_USER_AGENT, ...init?.headers } })
    })
    queue = run.then(() => undefined, () => undefined)
    return run
  }
}

async function getJson(fetch: FetchLike, url: string, service: string): Promise<any> {
  const res = await fetch(url)
  // Refusals (429, 403) are reported, not retried: the services ask clients to back off.
  if (!res.ok) throw new AcquireError(`${service} answered HTTP ${res.status}`)
  return JSON.parse(await res.text())
}

export async function lookupCrossref(fetch: FetchLike, paper: Pick<StudyPaper, 'title' | 'authors'>, at: string, rows = 5): Promise<LinkProposal[]> {
  const params = new URLSearchParams({ 'query.bibliographic': paper.title, rows: String(rows), select: 'DOI,title,issued,container-title' })
  if (paper.authors) params.set('query.author', paper.authors.split(/[,;]| and /)[0]!.trim())
  const url = `${CROSSREF}?${params}`
  const body = await getJson(fetch, url, 'Crossref')
  return (body.message?.items ?? []).filter((i: any) => i.title?.[0] && i.DOI).map((i: any): LinkProposal => {
    const m = titleMatch(paper.title, i.title[0])
    const year = i.issued?.['date-parts']?.[0]?.[0]
    return {
      service: 'crossref', title: i.title[0], doi: String(i.DOI).toLowerCase(), titleMatch: m.score, exactTitle: m.exact,
      ...(year ? { year: Number(year) } : {}), ...(i['container-title']?.[0] ? { journal: i['container-title'][0] } : {}),
      source: { kind: 'publication', citation: `Crossref ${url}`, retrievedAt: at },
    }
  })
}

export async function lookupEuropePmc(fetch: FetchLike, paper: Pick<StudyPaper, 'title'>, at: string, pageSize = 5): Promise<LinkProposal[]> {
  const title = paper.title.replace(/["\\]/g, ' ')
  const url = `${EUROPE_PMC}/search?${new URLSearchParams({ query: `TITLE:"${title}"`, format: 'json', resultType: 'lite', pageSize: String(pageSize) })}`
  const body = await getJson(fetch, url, 'Europe PMC')
  return (body.resultList?.result ?? []).filter((r: any) => r.title).map((r: any): LinkProposal => {
    const m = titleMatch(paper.title, r.title)
    const open = r.isOpenAccess === 'Y' && r.pmcid
    return {
      service: 'europepmc', title: String(r.title).replace(/\.$/, ''), titleMatch: m.score, exactTitle: m.exact,
      ...(r.pubYear ? { year: Number(r.pubYear) } : {}), ...(r.journalTitle ? { journal: r.journalTitle } : {}),
      ...(r.doi ? { doi: String(r.doi).toLowerCase() } : {}), ...(r.pmid ? { pmid: String(r.pmid) } : {}), ...(r.pmcid ? { pmcid: String(r.pmcid) } : {}),
      ...(open ? { supplementsUrl: `${EUROPE_PMC}/${r.pmcid}/supplementaryFiles` } : {}),
      source: { kind: 'publication', citation: `Europe PMC ${url}`, retrievedAt: at },
    }
  })
}

/**
 * Both services, best title match first. A service that fails is listed in `failed`, so a short list never looks
 * complete. Proposals below `minMatch` are dropped as noise.
 */
export async function lookupPaper(fetch: FetchLike, paper: Pick<StudyPaper, 'title' | 'authors'>, options: { at?: string; minMatch?: number } = {}): Promise<{ proposals: LinkProposal[]; failed: string[] }> {
  const at = options.at ?? new Date().toISOString()
  const failed: string[] = []
  const attempt = async (name: string, work: () => Promise<LinkProposal[]>) => {
    try { return await work() } catch (e) { failed.push(`${name}: ${(e as Error).message}`); return [] }
  }
  const all = [...(await attempt('Crossref', () => lookupCrossref(fetch, paper, at))), ...(await attempt('Europe PMC', () => lookupEuropePmc(fetch, paper, at)))]
  const proposals = all.filter((p) => p.titleMatch >= (options.minMatch ?? 0.5)).sort((a, b) => Number(b.exactTitle) - Number(a.exactTitle) || b.titleMatch - a.titleMatch || a.service.localeCompare(b.service))
  return { proposals, failed }
}

/** A person's approval of one proposal: the paper gains its DOI and PMID, each with where it came from, who and when. */
export function approveLink(paper: StudyPaper, proposal: LinkProposal, meta: { by?: string; at: string }): StudyPaper & { linkSource: ApprovedLink } {
  if (paper.doi && proposal.doi && paper.doi !== proposal.doi) throw new AcquireError(`This study already has DOI ${paper.doi}; remove it first to replace it`)
  if (paper.pmid && proposal.pmid && paper.pmid !== proposal.pmid) throw new AcquireError(`This study already has PMID ${paper.pmid}; remove it first to replace it`)
  return {
    ...paper,
    ...(proposal.doi ? { doi: proposal.doi } : {}),
    ...(proposal.pmid ? { pmid: proposal.pmid } : {}),
    linkSource: { ...(proposal.doi ? { doi: proposal.doi } : {}), ...(proposal.pmid ? { pmid: proposal.pmid } : {}), source: { ...proposal.source, ...(meta.by ? { approvedBy: meta.by } : {}), approvedAt: meta.at } },
  }
}
