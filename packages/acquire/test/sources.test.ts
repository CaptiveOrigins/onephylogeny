import { describe, expect, it } from 'vitest'
import { biosampleFor, boldCoverage, datasetsGenomes, listSraRuns, LOOKUP_USER_AGENT, looksLikeCoordinates, NcbiClient, occurrenceCoverage, type FetchLike } from '../src/index.js'

// Every response below is made up, shaped like the real ones (checked by hand against each service on 2026-11-11).
// The coordinates are invented and point nowhere in particular; they exist only to prove they are dropped.
const at = '2026-11-11T00:00:00.000Z'
const FAKE_LAT_LON = '10.1234 S 20.5678 W'
const FAKE_PAIR = '-11.11, -22.22'
const FAKE_DMS = '10°12\'S 20°34\'W'
const PERSON = 'Example Person'

const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
type Call = { url: string; body?: string; headers?: Record<string, string> }
const route = (calls: Call[], routes: [RegExp, unknown | ((url: string, body: URLSearchParams) => unknown)][]): FetchLike => async (url, init) => {
  calls.push({ url, ...(init?.body ? { body: init.body } : {}), ...(init?.headers ? { headers: init.headers } : {}) })
  const params = new URLSearchParams(init?.body ?? '')
  const key = `${url} ${params.get('db') ?? ''}`
  for (const [re, res] of routes) if (re.test(key)) return ok(typeof res === 'function' ? (res as (u: string, b: URLSearchParams) => unknown)(url, params) : res)
  return { ok: false, status: 404, text: async () => '' }
}
const client = (fetch: FetchLike) => new NcbiClient({ fetch, sleep: async () => {}, retries: 0 })
const noWait = { sleep: async () => {}, at }

const sraDoc = (n: number, layout: 'PAIRED' | 'SINGLE', strategy: string) => ({
  uid: String(n),
  expxml: ` <Summary><Title>A title naming ${PERSON}</Title><Platform instrument_model="Illumina NovaSeq 6000">ILLUMINA</Platform><Statistics total_runs="1"/></Summary><Submitter acc="SRA000001" center_name="Example Centre" contact_name="${PERSON}" lab_name="Example Lab"/><Experiment acc="SRX${n}" ver="1" status="public" name="x"/><Study acc="SRP1" name="A study"/><Organism taxid="50047" ScientificName="Chelonoidis carbonarius"/><Sample acc="SRS${n}" name=""/><Instrument ILLUMINA="Illumina NovaSeq 6000"/><Library_descriptor><LIBRARY_NAME>${PERSON} lib</LIBRARY_NAME><LIBRARY_STRATEGY>${strategy}</LIBRARY_STRATEGY><LIBRARY_SOURCE>GENOMIC</LIBRARY_SOURCE><LIBRARY_SELECTION>RANDOM</LIBRARY_SELECTION><LIBRARY_LAYOUT><${layout}/></LIBRARY_LAYOUT></Library_descriptor><Bioproject>PRJNA1</Bioproject><Biosample>SAMN${n}</Biosample>`,
  runs: `<Run acc="SRR${n}" total_spots="1000" total_bases="300000" load_done="true" is_public="true" cluster_name="public" static_data_available="true"/>${n === 2 ? '<Run acc="SRR2b" total_spots="" total_bases="" load_done="false"/>' : ''}`,
  createdate: '2025/08/14',
})

describe('SRA runs (roadmap stage 6.2)', () => {
  it('lists runs with strategy, layout, platform, bases, BioProject and BioSample, and nothing about the submitter', async () => {
    const calls: Call[] = []
    const fetch = route(calls, [
      [/esearch.* sra$/, { esearchresult: { count: '7', idlist: ['1', '2'] } }],
      [/esummary.* sra$/, { result: { uids: ['1', '2'], 1: sraDoc(1, 'PAIRED', 'WGS'), 2: sraDoc(2, 'SINGLE', 'RAD-Seq') } }],
    ])
    const out = await listSraRuns(client(fetch), '50047', { limit: 2, at })
    expect(out).toMatchObject({ source: 'NCBI SRA', retrieved: at, experiments: { total: 7, listed: 2 } })
    expect(out.runs).toHaveLength(3)
    expect(out.runs[0]).toEqual({ run: 'SRR1', experiment: 'SRX1', study: 'SRP1', bioProject: 'PRJNA1', bioSample: 'SAMN1', organism: 'Chelonoidis carbonarius', taxid: '50047', libraryStrategy: 'WGS', librarySource: 'GENOMIC', librarySelection: 'RANDOM', layout: 'PAIRED', platform: 'ILLUMINA', instrument: 'Illumina NovaSeq 6000', bases: 300000, spots: 1000, published: '2025/08/14' })
    expect(out.runs[1]).toMatchObject({ run: 'SRR2', layout: 'SINGLE', libraryStrategy: 'RAD-Seq' })
    expect(out.runs[2]).not.toHaveProperty('bases')
    expect(JSON.stringify(out)).not.toContain(PERSON)
    expect(new URLSearchParams(calls[0]!.body).get('term')).toBe('txid50047[Organism:exp]')
    expect(out.query).toMatch(/^https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/esearch\.fcgi\?db=sra&term=txid50047/)
    expect(out.requests).toHaveLength(2)
    // A listing only: no request goes to anything that serves reads.
    expect(calls.every((c) => /esearch|esummary/.test(c.url))).toBe(true)
  })

  it('searches by name when given one, and never puts an email or key in the query it reports', async () => {
    const calls: Call[] = []
    const fetch = route(calls, [[/esearch/, { esearchresult: { count: '0', idlist: [] } }]])
    const out = await listSraRuns(new NcbiClient({ fetch, sleep: async () => {}, email: 'someone@example.com', apiKey: 'k' }), 'Chelonoidis carbonarius', { at })
    expect(out.runs).toEqual([])
    expect(new URLSearchParams(calls[0]!.body).get('term')).toBe('"Chelonoidis carbonarius"[Organism:exp]')
    expect(out.query).not.toMatch(/email|api_key|@/)
  })
})

const bioDoc = (accession: string, attrs: [string, string][]) => ({
  uid: accession.slice(4), accession, organism: 'Chelonoidis carbonarius', taxonomy: '50047', publicationdate: '2025/08/14', package: 'Generic', organization: 'Example Lab',
  sampledata: `<BioSample access="public" accession="${accession}"><Ids><Id db="BioSample">${accession}</Id></Ids><Description><Title>x</Title></Description><Owner><Name>Example Lab</Name><Contacts><Contact email="person@example.com"><Name><First>Example</First><Last>Person</Last></Name></Contact></Contacts></Owner><Attributes>${attrs.map(([n, v]) => `<Attribute attribute_name="${n}" harmonized_name="${n}" display_name="${n}">${v}</Attribute>`).join('')}</Attributes></BioSample>`,
})

describe('BioSamples (roadmap stage 6.2)', () => {
  it('drops coordinates at parse time, by attribute name and by value, never reads contacts, and leaves out placeholders', async () => {
    const fetch = route([], [
      [/esearch.* biosample$/, { esearchresult: { count: '2', idlist: ['1', '2'] } }],
      [/esummary.* biosample$/, { result: { uids: ['1', '2'],
        1: bioDoc('SAMN1', [['isolate', 'T1'], ['sex', 'female'], ['geo_loc_name', 'Brazil: Example State'], ['lat_lon', FAKE_LAT_LON], ['collection_date', '2019-05-12'], ['biomaterial_provider', PERSON], ['collected_by', PERSON]]),
        2: bioDoc('SAMN2', [['geo_loc_name', `Brazil: ${FAKE_PAIR}`], ['specimen_voucher', `field note ${FAKE_DMS}`], ['tissue', 'blood'], ['decimal_latitude', '-11.11'], ['collection_date', 'missing'], ['sex', 'not collected']]),
      } }],
    ])
    const out = await biosampleFor(client(fetch), ['SAMN1', 'SAMN2', 'SAMN3', 'SAMN1'], { at })
    expect(out).toMatchObject({ source: 'NCBI BioSample', retrieved: at, missing: ['SAMN3'] })
    expect(out.samples[0]).toEqual({ accession: 'SAMN1', organism: 'Chelonoidis carbonarius', taxid: '50047', published: '2025/08/14', package: 'Generic', attributes: { isolate: 'T1', sex: 'female', geo_loc_name: 'Brazil: Example State', collection_date: '2019-05-12' }, withheld: ['lat_lon'] })
    expect(out.samples[1]!.attributes).toEqual({ tissue: 'blood' })
    expect(out.samples[1]!.withheld).toEqual(['decimal_latitude', 'geo_loc_name', 'specimen_voucher'])
    const all = JSON.stringify(out)
    for (const s of [FAKE_LAT_LON, '10.1234', '20.5678', '-11.11', '-22.22', '10°12', PERSON, 'Person', 'example.com', 'Example Lab']) expect(all).not.toContain(s)
  })

  it('refuses something that is not a BioSample accession before asking NCBI', async () => {
    const calls: Call[] = []
    await expect(biosampleFor(client(route(calls, [])), ['SAMN1', 'SRR1'])).rejects.toThrow(/SRR1 isn't a BioSample accession/)
    expect(calls).toEqual([])
  })

  it('tells coordinates from ordinary values', () => {
    for (const v of [FAKE_LAT_LON, FAKE_PAIR, FAKE_DMS, '3.5 N', '45.1 W', '12 ° 30']) expect(looksLikeCoordinates(v)).toBe(true)
    for (const v of ['Brazil: Example State', '2019-05-12', 'female', 'T1', 'blood', 'adult, 3 years', 'pen 2']) expect(looksLikeCoordinates(v)).toBe(false)
  })
})

const genome = (accession: string, x: Record<string, unknown> = {}) => ({
  accession, current_accession: accession, source_database: accession.startsWith('GCF') ? 'SOURCE_DATABASE_REFSEQ' : 'SOURCE_DATABASE_GENBANK',
  organism: { tax_id: 286002, organism_name: 'Gopherus example' },
  assembly_info: { assembly_level: 'Chromosome', assembly_status: 'current', assembly_name: 'rGopEx1', release_date: '2022-09-15', paired_assembly: { accession: accession.replace(/^GC[AF]/, (p) => (p === 'GCA' ? 'GCF' : 'GCA')) },
    biosample: { accession: 'SAMN9', lat_lon: FAKE_LAT_LON, collected_by: PERSON, owner: { name: PERSON, contacts: [{}] }, attributes: [{ name: 'lat_lon', value: FAKE_LAT_LON }] } },
  assembly_stats: { total_sequence_length: '2460542086' },
  ...x,
})

describe('NCBI Datasets genomes (roadmap stage 6.2)', () => {
  it('lists every page with level, size and whether a mitogenome is listed, and reads nothing from the BioSample', async () => {
    const calls: Call[] = []
    const fetch = route(calls, [
      [/page_token=next/, { reports: [genome('GCA_000000002.1', { organelle_info: [] })], total_count: 2 }],
      [/dataset_report/, { reports: [genome('GCA_000000001.1', { organelle_info: [{ description: 'Mitochondrion', total_seq_length: '16500', submitter: PERSON }] })], total_count: 2, next_page_token: 'next' }],
    ])
    const waits: number[] = []
    const out = await datasetsGenomes(fetch, 'Gopherus', { at, sleep: async (ms) => { waits.push(ms) }, now: () => 0 })
    expect(out).toMatchObject({ source: 'NCBI Datasets', retrieved: at, taxon: 'Gopherus', total: 2 })
    expect(out.genomes[0]).toEqual({ accession: 'GCA_000000001.1', database: 'genbank', pairedAccession: 'GCF_000000001.1', organism: 'Gopherus example', taxid: '286002', assemblyName: 'rGopEx1', assemblyLevel: 'Chromosome', status: 'current', length: 2460542086, released: '2022-09-15', organelles: ['Mitochondrion'], mitogenome: 'listed' })
    expect(out.genomes[1]!.mitogenome).toBe('not listed')
    expect(out.requests).toHaveLength(2)
    expect(out.query).toBe('https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/Gopherus/dataset_report?page_size=100')
    expect(waits).toEqual([1000])
    expect(calls[0]!.headers!['User-Agent']).toBe(LOOKUP_USER_AGENT)
    const all = JSON.stringify(out)
    for (const s of [FAKE_LAT_LON, PERSON, 'SAMN9']) expect(all).not.toContain(s)
  })

  it('reports a refusal once and does not retry it', async () => {
    const calls: Call[] = []
    const fetch: FetchLike = async (url) => { calls.push({ url }); return { ok: false, status: 429, text: async () => '' } }
    await expect(datasetsGenomes(fetch, '8487', noWait)).rejects.toThrow('NCBI Datasets refused the request (HTTP 429). Not retried')
    expect(calls).toHaveLength(1)
  })
})

const gbifMatch = { usageKey: 9533689, scientificName: 'Chelonoidis carbonarius (Spix, 1824)', canonicalName: 'Chelonoidis carbonarius', rank: 'SPECIES', status: 'ACCEPTED', matchType: 'EXACT', confidence: 99 }
const gbifSearch = { offset: 0, limit: 0, endOfRecords: false, count: 100, results: [], facets: [
  { field: 'COUNTRY', counts: [{ name: 'CO', count: 50 }, { name: 'BR', count: 40 }] },
  { field: 'BASIS_OF_RECORD', counts: [{ name: 'HUMAN_OBSERVATION', count: 70 }, { name: 'PRESERVED_SPECIMEN', count: 25 }, { name: 'LIVING_SPECIMEN', count: 5 }] },
  { field: 'LICENSE', counts: [{ name: 'CC_BY_NC_4_0', count: 60 }, { name: 'CC_BY_4_0', count: 30 }, { name: 'CC0_1_0', count: 10 }] },
  { field: 'DATASET_KEY', counts: [{ name: 'a', count: 60 }, { name: 'b', count: 40 }] },
] }
const idigbioCountry = { country: { colombia: { itemCount: 8 }, brasil: { itemCount: 14 }, brazil: { itemCount: 2 } }, itemCount: 30 }
const idigbioBasis = { basisofrecord: { preservedspecimen: { itemCount: 28 }, occurrence: { itemCount: 2 } }, itemCount: 30 }

describe('occurrence coverage (roadmap stage 6.2)', () => {
  it('counts GBIF records by country, basis of record and licence, asking for no records at all', async () => {
    const calls: Call[] = []
    const fetch = route(calls, [
      [/gbif\.org\/v1\/species\/match/, gbifMatch],
      [/gbif\.org\/v1\/occurrence\/search/, gbifSearch],
      [/idigbio.*country/, idigbioCountry],
      [/idigbio.*basisofrecord/, idigbioBasis],
    ])
    const out = await occurrenceCoverage(fetch, 'Chelonoidis carbonarius', noWait)
    expect(out.failed).toEqual([])
    expect(out.gbif).toMatchObject({ source: 'GBIF', retrieved: at, total: 100, noCountry: 10, datasets: 2, matched: { key: '9533689', rank: 'SPECIES', matchType: 'EXACT' } })
    expect(out.gbif!.byCountry).toEqual([{ name: 'CO', count: 50 }, { name: 'BR', count: 40 }])
    expect(out.gbif!.licences).toEqual([{ name: 'CC_BY_NC_4_0', count: 60 }, { name: 'CC_BY_4_0', count: 30 }, { name: 'CC0_1_0', count: 10 }])
    expect(out.gbif!.byBasisOfRecord.map((c) => c.name)).toContain('LIVING_SPECIMEN')
    const search = new URL(out.gbif!.query)
    expect(search.searchParams.get('limit')).toBe('0')
    expect(search.searchParams.getAll('facet')).toEqual(['country', 'basisOfRecord', 'license', 'datasetKey'])
    expect(out.idigbio).toMatchObject({ source: 'iDigBio', total: 30, noCountry: 6, licences: null })
    expect(out.idigbio!.byCountry).toEqual([{ name: 'brasil', count: 14 }, { name: 'colombia', count: 8 }, { name: 'brazil', count: 2 }])
    expect(out.idigbio!.byBasisOfRecord).toEqual([{ name: 'preservedspecimen', count: 28 }, { name: 'occurrence', count: 2 }])
    // Only the match and the facet search for GBIF, the two summaries for iDigBio: no record or download endpoints.
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/species/match', '/v1/occurrence/search', '/v2/summary/top/records/', '/v2/summary/top/records/'])
    expect(calls.every((c) => c.headers?.['User-Agent'] === LOOKUP_USER_AGENT)).toBe(true)
  })

  it('refuses a name GBIF only matches at a higher rank, and names a service that failed', async () => {
    const fetch: FetchLike = async (url) => {
      if (url.includes('species/match')) return ok({ ...gbifMatch, matchType: 'HIGHERRANK', rank: 'GENUS', canonicalName: 'Chelonoidis' })
      return { ok: false, status: 503, text: async () => '' }
    }
    const out = await occurrenceCoverage(fetch, 'Chelonoidis nonexistens', noWait)
    expect(out.gbif).toBeNull()
    expect(out.idigbio).toBeNull()
    expect(out.failed).toEqual(['GBIF: GBIF matched Chelonoidis nonexistens only at a higher rank (GENUS Chelonoidis). Not counted', 'iDigBio: iDigBio answered HTTP 503'])
  })

  it('says when GBIF matched a different spelling', async () => {
    const fetch = route([], [[/species\/match/, { ...gbifMatch, matchType: 'FUZZY' }], [/occurrence\/search/, gbifSearch]])
    const out = await occurrenceCoverage(fetch, 'Chelonoidis carbonaria', { ...noWait, idigbio: false })
    expect(out.idigbio).toBeNull()
    expect(out.gbif!.notes[0]).toMatch(/FUZZY/)
  })
})

describe('BOLD coverage (roadmap stage 6.2)', () => {
  it('resolves the name, then counts by country and marker from the summary', async () => {
    const calls: Call[] = []
    const fetch = route(calls, [
      [/preprocessor/, { successful_terms: [{ submitted: 'tax:na:Chelonoidis carbonarius', matched: 'tax:species:Chelonoidis carbonarius' }] }],
      [/api\/summary/, { 'country/ocean': { Colombia: 3, 'French Guiana': 1 }, marker_code: { 'COI-5P': 4 } }],
    ])
    const out = await boldCoverage(fetch, 'Chelonoidis carbonarius', noWait)
    expect(out).toMatchObject({ source: 'BOLD', retrieved: at, matched: 'tax:species:Chelonoidis carbonarius', byCountry: [{ name: 'Colombia', count: 3 }, { name: 'French Guiana', count: 1 }], byMarker: [{ name: 'COI-5P', count: 4 }] })
    expect(new URL(out.query).searchParams.get('fields')).toBe('country/ocean,marker_code')
    expect(calls).toHaveLength(2)
  })

  it('refuses a name BOLD does not know', async () => {
    const fetch = route([], [[/preprocessor/, { successful_terms: [], failed_terms: ['tax:Nothing'] }]])
    await expect(boldCoverage(fetch, 'Nothing', noWait)).rejects.toThrow(/BOLD has no taxon named Nothing/)
  })
})
