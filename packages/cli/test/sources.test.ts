import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NcbiClient, publicListings, type FetchLike } from '@captiveorigins/onephylogeny-acquire'
import { chosenKinds, ROWS, sourcesText, table } from '../src/sources'
// Made-up answers for every service. Nothing in this file reaches the network.
import { FAKE_TAXON, fakeSourcesFetch } from '../../../fixtures/sources/fake-services.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const cli = `${repo}packages/cli/dist/index.js`
const at = '2026-11-11T00:00:00.000Z'
const listings = (taxon: string, failing: string[] = [], only?: ('sra' | 'genomes' | 'occurrences' | 'bold')[]) => {
  const fetch = fakeSourcesFetch({ failing }) as FetchLike
  return publicListings({ fetch, client: new NcbiClient({ fetch, sleep: async () => {}, retries: 0 }) }, taxon, { at, sleep: async () => {}, ...(only ? { only } : {}) })
}

describe('sources: choosing and formatting', () => {
  it('asks for everything unless flags pick some', () => {
    expect(chosenKinds(() => false)).toEqual(['sra', 'genomes', 'occurrences', 'bold'])
    expect(chosenKinds((f) => f === 'bold' || f === 'sra')).toEqual(['sra', 'bold'])
  })

  it('lines up tables, with numbers to the right', () => {
    expect(table(['Name', 'Records'], [['CO', '700'], ['Brazil', '1,450']], [1])).toBe('Name    Records\n------  -------\nCO          700\nBrazil    1,450')
  })

  it('prints a section per source with counts, the query URL and when it was retrieved, and says what these are not', async () => {
    const text = sourcesText(await listings(FAKE_TAXON.id))
    expect(text).toContain(`# Public data for ${FAKE_TAXON.id}`)
    expect(text).toContain("They aren't evidence about any sample, and no coordinates are fetched or shown.")
    expect(text).toContain(`GBIF, iDigBio and BOLD were asked about ${FAKE_TAXON.name}, NCBI Taxonomy's name for taxon ${FAKE_TAXON.id}.`)
    expect(text).toContain('3 experiments in SRA, 2 runs listed. Only the first 2 were read. A listing only: no reads were downloaded.')
    expect(text).toMatch(/SRR900001\s+WGS\s+PAIRED\s+ILLUMINA\s+3,000,000,000\s+PRJNA900001\s+SAMN90000001\s+2025\/08\/14/)
    expect(text).toMatch(/GCA_900000001\.1\s+GenBank\s+Chromosome\s+2,460,542,086\s+2024-03-01\s+listed\s+GCF/)
    expect(text).toContain('Note: "not listed" doesn\'t mean the assembly has no mitogenome')
    expect(text).toContain('1,250 records from 3 datasets; 100 with no country. Counts only: no record and no coordinate was fetched.')
    expect(text).toMatch(/CO\s+700/)
    expect(text).toContain('Licences: not indexed per record by this service.')
    expect(text).toContain('Matched: tax:species:Examplus exemplaris.')
    expect(text).toContain('Query: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=sra&term=txid999001')
    expect(text).toContain('Query: https://api.gbif.org/v1/occurrence/search?taxonKey=9990001&limit=0')
    expect(text).toContain(`Retrieved: ${at} (2 requests)`)
    expect(text).toContain('Every service asked answered.')
    expect(text).not.toMatch(/email|api_key/)
  })

  it('names a failed service in its own section and at the end, never as zero', async () => {
    const text = sourcesText(await listings(FAKE_TAXON.name, ['idigbio', 'bold']))
    expect(text).toContain('## iDigBio occurrence counts\n\nFailed, so this count is unknown, not zero: iDigBio answered HTTP 503')
    expect(text).toContain('## BOLD record counts\n\nFailed, so this count is unknown, not zero: BOLD refused the request (HTTP 429). Not retried; try again later')
    expect(text).toContain("## Failed\n\n2 services didn't answer, so their counts are unknown, not zero:\n- iDigBio: iDigBio answered HTTP 503\n- BOLD: BOLD refused")
    expect(text).not.toContain('Every service asked answered.')
    expect(text).not.toMatch(/iDigBio occurrence counts\n\n0 records/)
  })

  it('prints only the sections asked for', async () => {
    const text = sourcesText(await listings(FAKE_TAXON.name, [], ['genomes']))
    expect(text).toContain('## NCBI Datasets genomes')
    expect(text).not.toMatch(/## (NCBI SRA|GBIF|iDigBio|BOLD)/)
  })

  it(`shows ${ROWS} rows and sums the rest rather than dropping them`, async () => {
    const l = await listings(FAKE_TAXON.name, [], ['occurrences'])
    l.gbif!.byCountry = Array.from({ length: ROWS + 3 }, (_, i) => ({ name: `C${i}`, count: 100 - i }))
    const text = sourcesText(l)
    expect(text).toContain(`C${ROWS - 1}`)
    expect(text).not.toContain(`C${ROWS} `)
    expect(text).toContain(`…and 3 more rows, with ${[ROWS, ROWS + 1, ROWS + 2].reduce((s, i) => s + 100 - i, 0)} records between them (--json lists every one).`)
  })
})

// The built command, with the network replaced by the same made-up answers (fixtures/sources/offline-sources.mjs).
const run = (env: Record<string, string>, ...a: string[]) => {
  const options = { cwd: repo, encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '--import ./fixtures/sources/offline-sources.mjs', NCBI_API_KEY: '', ...env } }
  try {
    return { code: 0, stdout: execFileSync('node', [cli, ...a], options), stderr: '' }
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string }
    return { code: err.status, stdout: err.stdout, stderr: err.stderr }
  }
}

describe('sources on the command line', () => {
  it('needs a taxon', () => {
    expect(existsSync(cli), 'build the CLI first: pnpm build').toBe(true)
    const r = run({}, 'sources')
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('--taxon is required')
  })

  it('prints the tables, and exits 1 naming a service that failed', () => {
    const r = run({ FAKE_SOURCES_FAILING: 'idigbio' }, 'sources', '--taxon', FAKE_TAXON.name, '--genomes', '--occurrences')
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('## NCBI Datasets genomes')
    expect(r.stdout).toContain('## GBIF occurrence counts')
    expect(r.stdout).toContain('- iDigBio: iDigBio answered HTTP 503')
    expect(r.stdout).not.toContain('## NCBI SRA runs')
  }, 30_000)

  it('prints JSON with --json, and exits 0 when every service answered', () => {
    const r = run({}, 'sources', '--taxon', FAKE_TAXON.name, '--bold', '--json')
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out).toMatchObject({ taxon: FAKE_TAXON.name, asked: ['bold'], failed: [], bold: { source: 'BOLD', byMarker: [{ name: 'COI-5P', count: 8 }] } })
  }, 30_000)
})
