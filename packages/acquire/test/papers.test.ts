import { describe, expect, it } from 'vitest'
import type { GenBankRecord } from '@captiveorigins/onephylogeny-core'
import { classifyAccessions, linkedAccessions, mergePapers, NcbiClient, searchEuropePmc, searchPapers, studiesFromRecords, type FetchLike, type FoundPaper } from '../src/index.js'

const blank = (id: string, x: Partial<FoundPaper> = {}): FoundPaper => ({ id, label: id, colorIndex: 0, title: `T ${id}`, sources: ['pubmed'], linked: [], linkLookup: 'not-done', ...x })
const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
const gb = (accession: string, references: GenBankRecord['references']): GenBankRecord => ({ accession, version: `${accession}.1`, definition: '', organism: 'Example', lineage: [], references, features: [], sequence: 'ACGT' })
const describeRecord = (r: GenBankRecord) => ({ accession: r.version, inTarget: true, hasMarker: true })

describe('merging papers', () => {
  it('joins on exact PMID or DOI and keeps what each source knew', () => {
    const [p, ...rest] = mergePapers([[blank('pmid:1', { pmid: '1', sources: ['genbank'], linked: [{ accession: 'A', inTarget: true, hasMarker: true }], linkLookup: 'done' })], [blank('pmid:1', { pmid: '1', doi: '10.1/x', year: 2020 })], [blank('doi:10.1/x', { doi: '10.1/x', sources: ['europepmc'], openAccess: true })]])
    expect(rest).toEqual([])
    expect(p).toMatchObject({ pmid: '1', doi: '10.1/x', year: 2020, openAccess: true, linkLookup: 'done' })
    expect(p!.sources).toEqual(['genbank', 'pubmed', 'europepmc'])
    expect(p!.linked).toHaveLength(1)
  })
  it('only marks matching titles, and never attaches records across them', () => {
    const out = mergePapers([[blank('genbank:x', { title: 'A Study: of Things', sources: ['genbank'], linked: [{ accession: 'A', inTarget: true, hasMarker: true }] })], [blank('pmid:2', { pmid: '2', title: 'A study of things.' })]])
    expect(out).toHaveLength(2)
    expect(out[0]!.possibleSameAs).toEqual(['pmid:2'])
    expect(out[1]!.linked).toEqual([])
  })
})

describe('studies from records', () => {
  it('groups by publication, and never drops a record with no publication', () => {
    const out = studiesFromRecords([
      gb('A', [{ title: 'Paper one', authors: 'Smith,A.', journal: 'J Example 1 (2019)', pubmedId: '9' }]),
      gb('B', [{ title: 'Paper one', authors: 'Smith,A.', journal: 'J Example 1 (2019)', pubmedId: '9' }]),
      gb('C', []),
      gb('D', [{ title: 'Direct Submission', authors: 'Jones,B.' }]),
    ], describeRecord)
    expect(out.map((p) => p.linked.length)).toEqual([2, 2])
    expect(out[0]).toMatchObject({ id: 'pmid:9', pmid: '9', year: 2019, label: 'Smith 2019' })
    expect(out[1]).toMatchObject({ unpublished: true, label: 'No publication' })
  })
})

describe('sources', () => {
  it('reads retraction notices and open access from Europe PMC', async () => {
    const fetch: FetchLike = async () => ok({ resultList: { result: [{ id: '1', pmid: '5', doi: '10.1/A', title: '<i>Thing</i> study.', authorString: 'Lee C, Kim D.', pubYear: '2021', isOpenAccess: 'Y', pubTypeList: { pubType: ['Journal Article', 'Retracted Publication'] } }] } })
    const { papers: [p], total } = await searchEuropePmc(fetch, 'x')
    expect(total).toBe(1)
    expect(p).toMatchObject({ id: 'pmid:5', title: 'Thing study', doi: '10.1/a', openAccess: true, notices: ['Retracted Publication'], label: 'Lee 2021' })
  })
  it('names a source that failed rather than showing a short list as complete', async () => {
    const fetch: FetchLike = async (url) => { if (url.includes('europepmc')) return { ok: false, status: 503, text: async () => '' }; return ok({ esearchresult: { idlist: [] } }) }
    const out = await searchPapers(new NcbiClient({ fetch, sleep: async () => {}, retries: 0 }), fetch, 'x')
    expect(out.failed).toEqual(['Europe PMC: Europe PMC answered HTTP 503'])
    expect(out.counts.PubMed).toBe(0)
  })
  it('gives no records when PubMed links none', async () => {
    const fetch: FetchLike = async () => ok({ linksets: [{}] })
    expect(await linkedAccessions(new NcbiClient({ fetch, sleep: async () => {} }), '1')).toEqual([])
  })
  it('counts an unannotated mitochondrial genome as holding a mitochondrial marker', async () => {
    const terms: string[] = []
    const fetch: FetchLike = async (_u, init) => { terms.push(new URLSearchParams(init?.body).get('term') ?? ''); return ok({ esearchresult: { count: '0', idlist: [] } }) }
    const selection = { id: 's', title: 's', taxa: [{ source: 'ncbi-taxonomy' as const, id: '1' }], marker: { kind: 'gene' as const, gene: 'g', organelle: 'mitochondrion' as const }, outgroups: [], exclude: [], filters: {} }
    await classifyAccessions(new NcbiClient({ fetch, sleep: async () => {} }), ['A.1'], selection)
    expect(terms[0]).toContain('txid1[Organism:exp]')
    expect(terms[1]).toContain('mitochondrion[Filter] AND 10000:25000[SLEN]')
  })
})
