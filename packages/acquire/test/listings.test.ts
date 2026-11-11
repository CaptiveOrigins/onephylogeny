import { describe, expect, it } from 'vitest'
import { NcbiClient, publicListings, type FetchLike } from '../src/index.js'
// Made-up answers for every service; nothing here reaches the network.
import { FAKE_TAXON, fakeSourcesFetch } from '../../../fixtures/sources/fake-services.mjs'

const at = '2026-11-11T00:00:00.000Z'
const setup = (failing: string[] = []) => {
  const calls: string[] = []
  const fetch = fakeSourcesFetch({ failing, calls }) as FetchLike
  return { calls, services: { fetch, client: new NcbiClient({ fetch, sleep: async () => {}, retries: 0 }) } }
}
const noWait = { at, sleep: async () => {} }

describe('every public listing for a taxon in one call', () => {
  it('runs each source once, in order, names a Taxonomy ID for GBIF, iDigBio and BOLD, and shares one retrieval time', async () => {
    const { calls, services } = setup()
    const out = await publicListings(services, ` ${FAKE_TAXON.id} `, noWait)
    expect(out).toMatchObject({ taxon: FAKE_TAXON.id, name: FAKE_TAXON.name, nameFrom: 'ncbi-taxonomy', asked: ['sra', 'genomes', 'occurrences', 'bold'], retrieved: at, failed: [] })
    expect(out.sra!.runs.map((r) => r.run)).toEqual(['SRR900001', 'SRR900002'])
    expect(out.genomes!.total).toBe(2)
    expect(out.gbif!.total).toBe(1250)
    expect(out.idigbio!.total).toBe(40)
    expect(out.bold!.byMarker).toEqual([{ name: 'COI-5P', count: 8 }])
    for (const r of [out.sra, out.genomes, out.gbif, out.idigbio, out.bold]) expect(r!.retrieved).toBe(at)
    expect(calls.map((u) => new URL(u).host)).toEqual(['eutils.ncbi.nlm.nih.gov', 'eutils.ncbi.nlm.nih.gov', 'api.ncbi.nlm.nih.gov', 'eutils.ncbi.nlm.nih.gov', 'api.gbif.org', 'api.gbif.org', 'search.idigbio.org', 'search.idigbio.org', 'portal.boldsystems.org', 'portal.boldsystems.org'])
  })

  it('asks only for what is wanted, and uses a name as given without asking NCBI Taxonomy', async () => {
    const { calls, services } = setup()
    const out = await publicListings(services, FAKE_TAXON.name, { ...noWait, only: ['bold'] })
    expect(out).toMatchObject({ name: FAKE_TAXON.name, nameFrom: 'given', asked: ['bold'], sra: null, genomes: null, gbif: null, idigbio: null, failed: [] })
    expect(calls.every((u) => u.startsWith('https://portal.boldsystems.org/'))).toBe(true)
  })

  it('names each service that failed and leaves its slot empty, never zero, while the others still answer', async () => {
    const { services } = setup(['datasets', 'idigbio', 'bold'])
    const out = await publicListings(services, FAKE_TAXON.name, noWait)
    expect(out.genomes).toBeNull()
    expect(out.idigbio).toBeNull()
    expect(out.bold).toBeNull()
    expect(out.sra).not.toBeNull()
    expect(out.gbif).not.toBeNull()
    expect(out.failed).toEqual([
      { service: 'NCBI Datasets', message: 'NCBI Datasets answered HTTP 503' },
      { service: 'iDigBio', message: 'iDigBio answered HTTP 503' },
      { service: 'BOLD', message: 'BOLD refused the request (HTTP 429). Not retried; try again later' },
    ])
  })

  it("doesn't ask GBIF, iDigBio or BOLD about bare digits when NCBI Taxonomy can't name the taxon", async () => {
    const { calls, services } = setup(['taxonomy'])
    const out = await publicListings(services, FAKE_TAXON.id, { ...noWait, only: ['occurrences', 'bold'] })
    expect(out.name).toBeNull()
    expect(out.failed.map((f) => f.service)).toEqual(['GBIF', 'iDigBio', 'BOLD'])
    expect(out.failed[0]!.message).toMatch(/^GBIF needs a scientific name, and NCBI Taxonomy couldn't name taxon 999001: efetch.fcgi failed: HTTP 503/)
    expect(calls.some((u) => /gbif|idigbio|bold/.test(u))).toBe(false)
  })

  it('refuses an empty taxon before asking anything', async () => {
    const { calls, services } = setup()
    await expect(publicListings(services, '  ')).rejects.toThrow('Name a taxon')
    expect(calls).toEqual([])
  })
})
