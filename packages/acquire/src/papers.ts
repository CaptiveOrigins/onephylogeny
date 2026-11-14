import { type GenBankRecord, type LinkedRecord, type Selection, type StudyPaper } from '@extantape/onephylogeny-core'
import { AcquireError, genomesHoldingMarkerQuery, markerTerm, type FetchLike, type NcbiClient } from './index.js'

/** A paper as a search found it. Nothing joins a Study until someone adds it. */
export type FoundPaper = StudyPaper & {
  /** Another listed entry whose title matches. A person decides, so records never attach to the wrong paper. */
  possibleSameAs?: string[]
}
export type PaperSearch = {
  papers: FoundPaper[]
  counts: Record<string, number>
  /** How many each source has in all. Where it's more than the count, the list was cut short. */
  totals: Record<string, number>
  sources: string[]
  failed: string[]
}
type Listed = { papers: FoundPaper[]; total: number }

const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const NOTICE = /retract|correct|erratum|expression of concern/i

const normalTitle = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const cleanTitle = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\.$/, '').trim()
const firstAuthor = (authors?: string) => authors?.split(/[,;]| and /)[0]?.trim().split(/\s+/)[0] ?? ''
const shortLabel = (authors: string | undefined, year: number | undefined, title: string) => [firstAuthor(authors) || title.split(/\s+/).slice(0, 3).join(' '), year].filter(Boolean).join(' ')

const blankPaper = (id: string, title: string): FoundPaper => ({ id, label: '', colorIndex: 0, title, sources: [], linked: [], linkLookup: 'not-done' })
const withLabel = (p: FoundPaper): FoundPaper => ({ ...p, label: shortLabel(p.authors, p.year, p.title) })

export async function searchEuropePmc(fetch: FetchLike, query: string, pageSize = 100): Promise<Listed> {
  const url = `${EUROPE_PMC}?${new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: String(pageSize) })}`
  const res = await fetch(url)
  if (!res.ok) throw new AcquireError(`Europe PMC answered HTTP ${res.status}`)
  const body = JSON.parse(await res.text())
  const results: any[] = body.resultList?.result ?? []
  const papers = results.filter((r) => r.title).map((r) => {
    const types: string[] = r.pubTypeList?.pubType ?? []
    const notices = types.filter((t) => NOTICE.test(t))
    return withLabel({
      ...blankPaper(r.pmid ? `pmid:${r.pmid}` : r.doi ? `doi:${String(r.doi).toLowerCase()}` : `epmc:${r.id}`, cleanTitle(r.title)),
      sources: ['europepmc'],
      ...(r.authorString ? { authors: r.authorString } : {}),
      ...(r.journalInfo?.journal?.title ? { journal: r.journalInfo.journal.title } : {}),
      ...(r.pubYear ? { year: Number(r.pubYear) } : {}),
      ...(r.doi ? { doi: String(r.doi).toLowerCase() } : {}),
      ...(r.pmid ? { pmid: String(r.pmid) } : {}),
      openAccess: r.isOpenAccess === 'Y',
      ...(notices.length ? { notices } : {}),
    })
  })
  return { papers, total: Number(body.hitCount ?? papers.length) }
}

export async function searchPubMed(client: NcbiClient, query: string, retmax = 100): Promise<Listed> {
  const search = JSON.parse(await client.request('esearch.fcgi', { db: 'pubmed', term: query, retmax: String(retmax), retmode: 'json' }))
  const ids: string[] = search.esearchresult?.idlist ?? []
  const total = Number(search.esearchresult?.count ?? ids.length)
  if (!ids.length) return { papers: [], total }
  const summary = JSON.parse(await client.request('esummary.fcgi', { db: 'pubmed', id: ids.join(','), retmode: 'json' })).result ?? {}
  const papers = ids.filter((id) => summary[id]?.title).map((id) => {
    const r = summary[id]
    const authors = (r.authors ?? []).map((a: { name: string }) => a.name).join(', ')
    const doi = (r.articleids ?? []).find((a: { idtype: string }) => a.idtype === 'doi')?.value
    const year = Number(String(r.pubdate ?? '').slice(0, 4))
    const notices = (r.pubtype ?? []).filter((t: string) => NOTICE.test(t))
    return withLabel({
      ...blankPaper(`pmid:${id}`, cleanTitle(r.title)),
      sources: ['pubmed'], pmid: id,
      ...(authors ? { authors } : {}),
      ...(r.fulljournalname ? { journal: r.fulljournalname } : {}),
      ...(year ? { year } : {}),
      ...(doi ? { doi: String(doi).toLowerCase() } : {}),
      ...(notices.length ? { notices } : {}),
    })
  })
  return { papers, total }
}

/** Records under one publication title, for the many that have no PubMed link. One submission can share a paper's title. */
export function studiesFromRecords(records: GenBankRecord[], describe: (r: GenBankRecord) => LinkedRecord): FoundPaper[] {
  const byKey = new Map<string, { paper: FoundPaper; linked: LinkedRecord[] }>()
  for (const r of records) {
    const pub = r.references.find((p) => p.title && p.title !== 'Direct Submission')
    // A record with no publication is listed anyway. Dropping it would hide it from the Study without saying so.
    const key = pub?.pubmedId ? `pmid:${pub.pubmedId}` : pub ? `genbank:${normalTitle(pub.title!)}` : 'genbank:no-publication'
    let entry = byKey.get(key)
    if (!entry) {
      const year = Number((pub?.journal ?? '').match(/\b(?:19|20)\d{2}\b/g)?.at(-1))
      const title = pub ? cleanTitle(pub.title!) : 'Records with no publication listed in GenBank'
      entry = { linked: [], paper: withLabel({
        ...blankPaper(key, title), sources: ['genbank'],
        ...(pub?.authors ? { authors: pub.authors } : {}),
        ...(pub?.journal ? { journal: pub.journal } : {}),
        ...(year ? { year } : {}),
        ...(pub?.pubmedId ? { pmid: pub.pubmedId } : {}),
        ...(pub ? {} : { unpublished: true }),
      }) }
      if (!pub) entry.paper.label = 'No publication'
      byKey.set(key, entry)
    }
    entry.linked.push(describe(r))
  }
  return [...byKey.values()].map(({ paper, linked }) => ({ ...paper, linked, linkLookup: 'done' as const }))
}

/**
 * Joins lists on exact PMID or DOI. Matching titles are only marked: a person decides those, so records never attach to the wrong paper.
 */
export function mergePapers(lists: FoundPaper[][]): FoundPaper[] {
  const out: FoundPaper[] = []
  for (const paper of lists.flat()) {
    const same = out.find((p) => (paper.pmid && p.pmid === paper.pmid) || (paper.doi && p.doi === paper.doi))
    if (!same) { out.push(paper); continue }
    same.sources = [...new Set([...same.sources, ...paper.sources])]
    same.linked = same.linked.length ? same.linked : paper.linked
    if (same.linkLookup !== 'done') same.linkLookup = paper.linkLookup
    same.authors ??= paper.authors as string
    same.doi ??= paper.doi as string
    same.pmid ??= paper.pmid as string
    same.journal ??= paper.journal as string
    same.year ??= paper.year as number
    if (paper.notices) same.notices = [...new Set([...(same.notices ?? []), ...paper.notices])]
    if (paper.openAccess) same.openAccess = true
  }
  for (const p of out) {
    const twins = out.filter((q) => q !== p && !p.unpublished && !q.unpublished && normalTitle(q.title) === normalTitle(p.title)).map((q) => q.id)
    if (twins.length) p.possibleSameAs = twins
  }
  return out
}

/** Searches every source and reports any that failed, because a partial list mustn't look complete. */
export async function searchPapers(client: NcbiClient, fetch: FetchLike, query: string, records: FoundPaper[] = []): Promise<PaperSearch> {
  const failed: string[] = []
  const attempt = async (name: string, work: () => Promise<Listed>): Promise<Listed> => {
    try { return await work() } catch (e) { failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); return { papers: [], total: 0 } }
  }
  const empty = !query.trim()
  const pubmed = empty ? { papers: [], total: 0 } : await attempt('PubMed', () => searchPubMed(client, query))
  const europe = empty ? { papers: [], total: 0 } : await attempt('Europe PMC', () => searchEuropePmc(fetch, query))
  return {
    papers: mergePapers([records, pubmed.papers, europe.papers]),
    counts: { PubMed: pubmed.papers.length, 'Europe PMC': europe.papers.length, 'GenBank studies': records.length },
    totals: { PubMed: pubmed.total, 'Europe PMC': europe.total, 'GenBank studies': records.length },
    sources: [...(empty ? [] : ['PubMed', 'Europe PMC']), ...(records.length ? ['GenBank'] : [])],
    failed,
  }
}

/** Nucleotide records PubMed links to a paper. Most records have no such link, so an empty list doesn't mean the paper has none. */
export async function linkedAccessions(client: NcbiClient, pmid: string): Promise<string[]> {
  const r = JSON.parse(await client.request('elink.fcgi', { dbfrom: 'pubmed', db: 'nuccore', linkname: 'pubmed_nuccore', id: pmid, retmode: 'json' }))
  const ids: string[] = r.linksets?.[0]?.linksetdbs?.[0]?.links ?? []
  if (!ids.length) return []
  const out: string[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const s = JSON.parse(await client.request('esummary.fcgi', { db: 'nuccore', id: ids.slice(i, i + 200).join(','), retmode: 'json' })).result ?? {}
    for (const id of s.uids ?? []) if (s[id]?.accessionversion) out.push(s[id].accessionversion)
  }
  return out
}

const taxaTerm = (selection: Selection) => selection.taxa.filter((t) => t.source === 'ncbi-taxonomy').map((t) => `txid${t.id}[Organism:exp]`).join(' OR ')

/** Which accessions are of the target taxa, and which hold the marker. Whole mitochondrial genomes hold it even when unannotated. */
export async function classifyAccessions(client: NcbiClient, accessions: string[], selection: Selection): Promise<{ inTarget: Set<string>; hasMarker: Set<string> }> {
  const inTarget = new Set<string>()
  const hasMarker = new Set<string>()
  const genomeTerm = genomesHoldingMarkerQuery(selection) ? ' OR (mitochondrion[Filter] AND 10000:25000[SLEN])' : ''
  for (let i = 0; i < accessions.length; i += 150) {
    const chunk = accessions.slice(i, i + 150)
    const list = `(${chunk.map((a) => `${a}[Accession]`).join(' OR ')})`
    for (const a of await client.searchAccessions(`${list} AND (${taxaTerm(selection)})`)) inTarget.add(a)
    for (const a of await client.searchAccessions(`${list} AND ((${markerTerm(selection.marker)})${genomeTerm})`)) hasMarker.add(a)
  }
  return { inTarget, hasMarker }
}
