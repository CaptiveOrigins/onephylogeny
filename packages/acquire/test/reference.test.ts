import { describe, expect, it } from 'vitest'
import type { Selection } from '@captiveorigins/onephylogeny-core'
import { NcbiClient, suggestReference, type FetchLike } from '../src/index.js'

const fast = { sleep: async () => {}, delayMs: 0, retries: 0 }
const ok = (body: string) => ({ ok: true, status: 200, text: async () => body })
const taxonXml = (code: number) => `<TaxaSet><Taxon><TaxId>50</TaxId><ScientificName>Examplus species</ScientificName><MitoGeneticCode><MGCId>${code}</MGCId><MGCName>x</MGCName></MitoGeneticCode><LineageEx><Taxon><TaxId>9</TaxId><ScientificName>Examplidae</ScientificName><Rank>family</Rank></Taxon><Taxon><TaxId>8</TaxId><ScientificName>Examplus</ScientificName><Rank>genus</Rank></Taxon></LineageEx></Taxon></TaxaSet>`
const selection = (over: Partial<Selection['marker']> = {}): Selection => ({ id: 's', title: 'S', taxa: [{ source: 'ncbi-taxonomy', id: '50' }], marker: { kind: 'gene', gene: 'cytb', organelle: 'mitochondrion', ...over }, outgroups: [], exclude: [], filters: {} } as Selection)

/** RefSeq genomes by the taxon each search names. */
function ncbi(code: number, genomes: Record<string, { id: string; accession: string; organism: string; slen: number }[]>, seen: string[] = []): FetchLike {
  return async (url, init) => {
    const p = new URLSearchParams(init?.body)
    if (p.get('db') === 'taxonomy') return ok(taxonXml(code))
    const term = p.get('term') ?? ''
    seen.push(term)
    const tx = /txid(\d+)/.exec(term)?.[1] ?? ''
    if (url.includes('esearch')) return ok(JSON.stringify({ esearchresult: { idlist: (genomes[tx] ?? []).map((g) => g.id) } }))
    const all = Object.values(genomes).flat()
    return ok(JSON.stringify({ result: Object.fromEntries(all.map((g) => [g.id, { accessionversion: g.accession, organism: g.organism, slen: g.slen, title: `${g.organism} mitochondrion, complete genome` }])) }))
  }
}

describe('guided setup: suggesting a reference (roadmap stage 3)', () => {
  it('suggests the taxon\'s own RefSeq mitogenome first, and its vertebrate mitochondrial code', async () => {
    const seen: string[] = []
    const client = new NcbiClient({ fetch: ncbi(2, { 50: [{ id: '1', accession: 'NC_000002.1', organism: 'Examplus other', slen: 17000 }, { id: '2', accession: 'NC_000001.1', organism: 'Examplus species', slen: 16500 }] }, seen), ...fast })
    const s = await suggestReference(client, selection())
    expect(s.from).toEqual({ id: '50', name: 'Examplus species', rank: 'taxon', sameTaxon: true })
    expect(s.candidates.map((c) => c.accession)).toEqual(['NC_000001.1', 'NC_000002.1'])
    expect(s.geneticCode).toEqual({ code: 2, supported: true, label: 'Vertebrate mitochondrial (2)' })
    expect(seen[0]).toContain('refseq[Filter]')
  })

  it('walks up to a relative when the taxon has none, and says so', async () => {
    const client = new NcbiClient({ fetch: ncbi(2, { 8: [{ id: '3', accession: 'NC_000003.1', organism: 'Examplus cousin', slen: 16800 }] }), ...fast })
    const s = await suggestReference(client, selection())
    expect(s.from).toMatchObject({ id: '8', rank: 'genus', sameTaxon: false })
    expect(s.notes[0]).toMatch(/No RefSeq mitochondrial genome for Examplus species itself/)
  })

  it('offers no frame check for a code it doesn\'t support, and nothing for a non-mitochondrial marker', async () => {
    const invertebrate = await suggestReference(new NcbiClient({ fetch: ncbi(5, {}), ...fast }), selection())
    expect(invertebrate.geneticCode).toMatchObject({ code: 5, supported: false })
    expect(invertebrate.candidates).toEqual([])
    expect(invertebrate.notes[0]).toMatch(/No RefSeq mitochondrial genome within 2 levels/)
    const nuclear = await suggestReference(new NcbiClient({ fetch: ncbi(2, {}), ...fast }), selection({ organelle: undefined, gene: 'rag1' }))
    expect(nuclear).toMatchObject({ candidates: [], geneticCode: { supported: false } })
    expect(nuclear.notes[0]).toMatch(/Only mitochondrial markers/)
  })

  it('asks for a taxon first', async () => {
    const s = await suggestReference(new NcbiClient({ fetch: ncbi(2, {}), ...fast }), { ...selection(), taxa: [] })
    expect(s.geneticCode).toEqual({ supported: false, reason: 'Choose an NCBI taxon first' })
  })
})
