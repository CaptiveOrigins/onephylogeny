import { describe, expect, it } from 'vitest'
import type { StudyPaper } from '@captiveorigins/onephylogeny-core'
import { approveLink, LOOKUP_USER_AGENT, lookupPaper, paced, titleMatch, type FetchLike } from '../src/index.js'

const at = '2026-11-10T00:00:00.000Z'
const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
const paper: StudyPaper = { id: 'genbank:x', label: 'Smith 2015', colorIndex: 0, title: 'Phylogeography of an example tortoise in South America', authors: 'Smith,J., Jones,K.', sources: ['genbank'], linked: [], linkLookup: 'done' }
const crossref = { message: { items: [
  { DOI: '10.1000/ABC', title: ['Phylogeography of an Example Tortoise in South America'], issued: { 'date-parts': [[2016]] }, 'container-title': ['Journal of Examples'] },
  { DOI: '10.1000/other', title: ['Something unrelated entirely'], issued: { 'date-parts': [[2001]] } },
] } }
const europe = { resultList: { result: [{ title: 'Phylogeography of an example tortoise in South America.', pubYear: '2016', doi: '10.1000/abc', pmid: '123', pmcid: 'PMC9', isOpenAccess: 'Y', journalTitle: 'J Ex' }] } }
const fake = (calls: { url: string; headers?: Record<string, string> }[], fail?: string): FetchLike => async (url, init) => {
  calls.push({ url, ...(init?.headers ? { headers: init.headers } : {}) })
  if (fail && url.includes(fail)) return { ok: false, status: 429, text: async () => '' }
  return ok(url.includes('crossref') ? crossref : europe)
}

describe('paper lookup (roadmap stage 3)', () => {
  it('matches titles by shared words, ignoring case, punctuation and markup', () => {
    expect(titleMatch('A <i>Study</i> of Things.', 'a study of things')).toEqual({ score: 1, exact: true })
    expect(titleMatch('A study of things', 'A study of other things').score).toBeCloseTo(0.8)
  })

  it('proposes links from both services, best match first, with source and supplements, and drops noise', async () => {
    const calls: { url: string }[] = []
    const { proposals, failed } = await lookupPaper(fake(calls), paper, { at })
    expect(failed).toEqual([])
    expect(proposals.map((p) => [p.service, p.doi, p.exactTitle])).toEqual([['crossref', '10.1000/abc', true], ['europepmc', '10.1000/abc', true]])
    expect(proposals[1]).toMatchObject({ pmid: '123', pmcid: 'PMC9', supplementsUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9/supplementaryFiles', year: 2016 })
    expect(proposals[0]!.source).toMatchObject({ kind: 'publication', retrievedAt: at })
    expect(proposals[0]!.source.citation).toMatch(/^Crossref https:\/\/api\.crossref\.org\/works\?/)
    expect(calls[0]!.url).toContain('query.author=Smith')
  })

  it('reports a service that refused, rather than looking complete', async () => {
    const { proposals, failed } = await lookupPaper(fake([], 'crossref'), paper, { at })
    expect(failed).toEqual(['Crossref: Crossref answered HTTP 429'])
    expect(proposals.map((p) => p.service)).toEqual(['europepmc'])
  })

  it('paces requests one at a time, a second apart, and names the tool, never a person', async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = []
    const waits: number[] = []
    let clock = 0
    const f = paced(fake(calls), 1000, async (ms) => { waits.push(ms); clock += ms }, () => clock)
    await Promise.all([f('https://api.crossref.org/works?a'), f('https://api.crossref.org/works?b'), f('https://www.ebi.ac.uk/europepmc/x')])
    expect(calls).toHaveLength(3)
    expect(waits).toEqual([1000, 1000])
    expect(calls[0]!.headers!['User-Agent']).toBe(LOOKUP_USER_AGENT)
    expect(LOOKUP_USER_AGENT).not.toMatch(/@/)
  })

  it('attaches a link only on approval, recording where it came from, who and when, and never overwrites one', async () => {
    const { proposals } = await lookupPaper(fake([]), paper, { at })
    const approved = approveLink(paper, proposals[1]!, { by: 'curator-1', at })
    expect(approved).toMatchObject({ doi: '10.1000/abc', pmid: '123' })
    expect(approved.linkSource.source).toMatchObject({ kind: 'publication', approvedBy: 'curator-1', approvedAt: at, retrievedAt: at })
    expect(paper.doi).toBeUndefined()
    expect(() => approveLink({ ...paper, doi: '10.9/zzz' }, proposals[0]!, { at })).toThrow(/already has DOI/)
  })
})
