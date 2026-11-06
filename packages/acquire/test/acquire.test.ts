import { describe, expect, it } from 'vitest'
import { AcquireError, genomesHoldingMarkerQuery, markerTerm, NcbiClient, selectionQuery, suggestOutgroups, type FetchLike } from '../src/index.js'
import type { Selection } from '@captiveorigins/onephylogeny-core'

const selection: Selection = { id: 's', title: 'S', taxa: [{ source: 'ncbi-taxonomy', id: '100' }], marker: { kind: 'gene', gene: 'g1', synonyms: ['g2'], products: ['product x'], organelle: 'mitochondrion' }, outgroups: [], exclude: [], filters: {} }
const flat = (name: string, n = 1) => `LOCUS       ${name}  3 bp DNA\nACCESSION   ${name}\nVERSION     ${name}.${n}\nORIGIN\n        1 acg\n//\n`
const fast = { sleep: async () => {}, delayMs: 0 }
const respond = (text: string, ok = true, status = 200) => ({ ok, status, text: async () => text })

describe('queries', () => {
  it('comes entirely from configuration', () => {
    expect(selectionQuery(selection)).toBe('(txid100[Organism:exp]) AND gene_in_mitochondrion[PROP] AND ("g1"[Gene] OR "g2"[Gene] OR "product x"[Protein Name]) NOT refseq[Filter]')
  })
  it('says SNP data needs an import', () => {
    expect(() => markerTerm({ kind: 'snp' })).toThrow(/Import/)
  })
})

describe('NCBI client', () => {
  it('retries server failures, then succeeds', async () => {
    let calls = 0
    const fetch: FetchLike = async () => (++calls < 3 ? respond('', false, 503) : respond(flat('A1')))
    const r = await new NcbiClient({ fetch, ...fast }).fetchGenBankText(['A1.1'])
    expect(calls).toBe(3)
    expect(r.records.map((x) => x.version)).toEqual(['A1.1'])
  })
  it('throws after retries instead of skipping', async () => {
    const fetch: FetchLike = async () => respond('', false, 500)
    await expect(new NcbiClient({ fetch, retries: 1, ...fast }).fetchGenBankText(['A1.1'])).rejects.toBeInstanceOf(AcquireError)
  })
  it('does not retry a request NCBI refuses', async () => {
    let calls = 0
    const fetch: FetchLike = async () => { calls++; return respond('', false, 400) }
    await expect(new NcbiClient({ fetch, ...fast }).request('x', {})).rejects.toThrow('HTTP 400')
    expect(calls).toBe(1)
  })
  it('fails when a batch comes back short', async () => {
    const fetch: FetchLike = async () => respond(flat('A1'))
    await expect(new NcbiClient({ fetch, ...fast }).fetchGenBankText(['A1.1', 'B2.1'])).rejects.toThrow(/did not return 1 of 2/)
  })
  it('reads every page and removes duplicates', async () => {
    const pages = [['A.1', 'B.1'], ['B.1', 'C.1']]
    const fetch: FetchLike = async (_u, init) => {
      const start = Number(new URLSearchParams(init!.body).get('retstart'))
      return respond(JSON.stringify({ esearchresult: { count: '4', idlist: pages[start ? 1 : 0] } }))
    }
    expect(await new NcbiClient({ fetch, ...fast }).searchAccessions('t', 2)).toEqual(['A.1', 'B.1', 'C.1'])
  })
  it('fails when a search stops early', async () => {
    const fetch: FetchLike = async () => respond(JSON.stringify({ esearchresult: { count: '5', idlist: [] } }))
    await expect(new NcbiClient({ fetch, ...fast }).searchAccessions('t')).rejects.toThrow(/stopped at 0 of 5/)
  })
})

describe('outgroup ladder', () => {
  const lineage = `<TaxaSet><Taxon><ScientificName>Ingroup species</ScientificName><LineageEx>
    <Taxon><TaxId>1</TaxId><ScientificName>Order</ScientificName><Rank>order</Rank></Taxon>
    <Taxon><TaxId>2</TaxId><ScientificName>Family</ScientificName><Rank>family</Rank></Taxon>
    <Taxon><TaxId>3</TaxId><ScientificName>Genus</ScientificName><Rank>genus</Rank></Taxon></LineageEx></Taxon></TaxaSet>`
  const fetch: FetchLike = async (url, init) => {
    const p = new URLSearchParams(init!.body)
    if (url.includes('efetch')) return respond(lineage)
    if (url.includes('esummary')) {
      const orgs: Record<string, string> = { a: 'Sister one', b: 'Far one', c: 'Far two' }
      return respond(JSON.stringify({ result: Object.fromEntries(p.get('id')!.split(',').map((id) => [id, { accessionversion: `${id}.1`, organism: orgs[id], slen: 900 }])) }))
    }
    const term = p.get('term')!
    const ids = term.startsWith('txid3') ? ['a'] : term.startsWith('txid2') ? ['b', 'c'] : []
    return respond(JSON.stringify({ esearchresult: { count: String(ids.length), idlist: ids } }))
  }
  it('jumps outward until enough species have the marker', async () => {
    const ladder = await suggestOutgroups(new NcbiClient({ fetch, ...fast }), selection)
    expect(ladder.steps.map((s) => [s.taxon.name, s.species.length, s.sufficient])).toEqual([['Genus', 1, false], ['Family', 2, true]])
    expect(ladder.suggested?.candidates.map((c) => c.accession)).toEqual(['b.1', 'c.1'])
    expect(ladder.caveat).toMatch(/not evidence/)
  })
  it('excludes the previous step at each jump', async () => {
    const terms: string[] = []
    const spy: FetchLike = (u, i) => { terms.push(new URLSearchParams(i!.body).get('term') ?? ''); return fetch(u, i) }
    await suggestOutgroups(new NcbiClient({ fetch: spy, ...fast }), selection)
    expect(terms.some((t) => t.startsWith('txid2[Organism:exp] NOT txid3[Organism:exp]'))).toBe(true)
  })

  it('asks for whole genomes only when a mitochondrial gene could sit unannotated in one', () => {
    const taxa = [{ source: 'ncbi-taxonomy' as const, id: '100' }]
    const base = { id: 's', title: 's', taxa, outgroups: [], exclude: [], filters: {} }
    expect(genomesHoldingMarkerQuery({ ...base, marker: { kind: 'gene', gene: 'g', organelle: 'mitochondrion' } })).toBe('(txid100[Organism:exp]) AND mitochondrion[Filter] AND 10000:25000[SLEN] NOT refseq[Filter]')
    expect(genomesHoldingMarkerQuery({ ...base, marker: { kind: 'gene', gene: 'g' } })).toBeNull()
    expect(genomesHoldingMarkerQuery({ ...base, marker: { kind: 'mitogenome' } })).toBeNull()
  })
})
