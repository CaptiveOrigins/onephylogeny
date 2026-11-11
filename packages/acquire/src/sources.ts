import { AcquireError, type FetchLike, type NcbiClient } from './index.js'
import { paced } from './lookup.js'

/**
 * More record sources (roadmap stage 6.2): listings and counts only. Nothing here downloads reads, genomes or
 * individual occurrence records, and nothing returns or keeps coordinates.
 *
 * Etiquette is the same as the paper lookup's: one request at a time, at least a second apart (NCBI E-utilities go
 * through `NcbiClient`, which keeps to NCBI's documented three a second), a User-Agent naming this tool and its
 * repository and never a person, and a refusal (HTTP 403 or 429) is reported, never retried.
 */

/** Where a listing came from: the service, when, and the request that produced it. */
export type Provenance = {
  source: string
  /** ISO 8601 time the listing was retrieved. */
  retrieved: string
  /** The main request, as a URL a person can open. Never carries an email or API key. */
  query: string
  /** Every request made, in order. */
  requests: string[]
}

export type SourceOptions = {
  /** Retrieval time to record. Defaults to now. */
  at?: string
  /** Pause between this call's requests. A second unless set higher. */
  gapMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
const DATASETS = 'https://api.ncbi.nlm.nih.gov/datasets/v2/'
const GBIF = 'https://api.gbif.org/v1/'
const IDIGBIO = 'https://search.idigbio.org/v2/'
const BOLD = 'https://portal.boldsystems.org/api/'

/** A fetch for one call: paced and carrying the tool's User-Agent, whatever the caller passed. */
const pacedFor = (fetch: FetchLike, o: SourceOptions) => paced(fetch, Math.max(1000, o.gapMs ?? 1000), o.sleep, o.now)

async function getJson(fetch: FetchLike, url: string, service: string, requests: string[]): Promise<any> {
  requests.push(url)
  const res = await fetch(url)
  if (res.status === 403 || res.status === 429) throw new AcquireError(`${service} refused the request (HTTP ${res.status}). Not retried; try again later`)
  if (!res.ok) throw new AcquireError(`${service} answered HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new AcquireError(`${service} did not return JSON`)
  }
}

/** An E-utilities request as a GET URL to show a person: the tool name only, never an email or key. */
const eutilsUrl = (path: string, params: Record<string, string>) => `${EUTILS}${path}?${new URLSearchParams({ ...params, tool: 'onephylogeny' })}`

async function eutils(client: NcbiClient, path: string, params: Record<string, string>, requests: string[]): Promise<any> {
  requests.push(eutilsUrl(path, params))
  const text = await client.request(path, { ...params, retmode: 'json' })
  try {
    return JSON.parse(text)
  } catch {
    throw new AcquireError(`${path} did not return JSON`)
  }
}

/** A taxon for NCBI: digits are a Taxonomy ID, anything else a scientific name. Subtaxa are included. */
export function ncbiTaxonTerm(taxon: string): string {
  const t = taxon.trim()
  if (!t) throw new AcquireError('Name a taxon')
  return /^\d+$/.test(t) ? `txid${t}[Organism:exp]` : `"${t.replace(/"/g, '')}"[Organism:exp]`
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim()
const attr = (xml: string, tag: string, name: string) => {
  const el = new RegExp(`<${tag}\\b[^>]*>`).exec(xml)?.[0]
  const v = el && new RegExp(`\\b${name}="([^"]*)"`).exec(el)?.[1]
  return v ? decode(v) : undefined
}
const text = (xml: string, tag: string) => {
  const v = new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}>`).exec(xml)?.[1]
  return v ? decode(v) : undefined
}
const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined)

// --- SRA ---------------------------------------------------------------------------------------------------------

export type SraRun = {
  run: string
  experiment?: string
  study?: string
  bioProject?: string
  bioSample?: string
  organism?: string
  taxid?: string
  /** WGS, RNA-Seq, AMPLICON, RAD-Seq and so on, as SRA has it. */
  libraryStrategy?: string
  librarySource?: string
  librarySelection?: string
  layout?: 'PAIRED' | 'SINGLE'
  platform?: string
  instrument?: string
  bases?: number
  spots?: number
  /** As SRA gives it, YYYY/MM/DD. */
  published?: string
}

export type SraListing = Provenance & {
  taxon: string
  /** Experiments SRA has for the search, and how many were read. Where `listed` is less, the list was cut short. */
  experiments: { total: number; listed: number }
  runs: SraRun[]
}

/**
 * Parses one SRA esummary document into its runs. Submitter, contact, titles and library names and protocols are
 * never read, so they can't be passed on.
 */
export function parseSraSummary(doc: { expxml?: string; runs?: string; createdate?: string }): SraRun[] {
  const x = doc.expxml ?? ''
  const layout = /<LIBRARY_LAYOUT>\s*<(PAIRED|SINGLE)\b/.exec(x)?.[1] as SraRun['layout'] | undefined
  const shared = {
    ...(attr(x, 'Experiment', 'acc') ? { experiment: attr(x, 'Experiment', 'acc')! } : {}),
    ...(attr(x, 'Study', 'acc') ? { study: attr(x, 'Study', 'acc')! } : {}),
    ...(text(x, 'Bioproject') ? { bioProject: text(x, 'Bioproject')! } : {}),
    ...(text(x, 'Biosample') ? { bioSample: text(x, 'Biosample')! } : {}),
    ...(attr(x, 'Organism', 'ScientificName') ? { organism: attr(x, 'Organism', 'ScientificName')! } : {}),
    ...(attr(x, 'Organism', 'taxid') ? { taxid: attr(x, 'Organism', 'taxid')! } : {}),
    ...(text(x, 'LIBRARY_STRATEGY') ? { libraryStrategy: text(x, 'LIBRARY_STRATEGY')! } : {}),
    ...(text(x, 'LIBRARY_SOURCE') ? { librarySource: text(x, 'LIBRARY_SOURCE')! } : {}),
    ...(text(x, 'LIBRARY_SELECTION') ? { librarySelection: text(x, 'LIBRARY_SELECTION')! } : {}),
    ...(layout ? { layout } : {}),
    ...(text(x, 'Platform') ? { platform: text(x, 'Platform')! } : {}),
    ...(attr(x, 'Platform', 'instrument_model') ? { instrument: attr(x, 'Platform', 'instrument_model')! } : {}),
    ...(doc.createdate ? { published: doc.createdate } : {}),
  }
  return [...(doc.runs ?? '').matchAll(/<Run\b[^>]*>/g)].flatMap(([el]) => {
    const run = /\bacc="([^"]+)"/.exec(el)?.[1]
    if (!run) return []
    const bases = num(/\btotal_bases="([^"]*)"/.exec(el)?.[1])
    const spots = num(/\btotal_spots="([^"]*)"/.exec(el)?.[1])
    return [{ run, ...shared, ...(bases !== undefined ? { bases } : {}), ...(spots !== undefined ? { spots } : {}) }]
  })
}

/**
 * SRA runs for a taxon and its subtaxa: run accession, library strategy, layout, platform, bases, BioProject and
 * BioSample. A listing only; no reads are downloaded. `limit` caps the experiments read, and the result says how many
 * there were in all.
 */
export async function listSraRuns(client: NcbiClient, taxon: string, options: { limit?: number; at?: string } = {}): Promise<SraListing> {
  const requests: string[] = []
  const retrieved = options.at ?? new Date().toISOString()
  const term = ncbiTaxonTerm(taxon)
  const search = await eutils(client, 'esearch.fcgi', { db: 'sra', term, retmax: String(options.limit ?? 500) }, requests)
  const res = search.esearchresult
  if (!res || res.ERROR) throw new AcquireError(`SRA search failed: ${String(res?.ERROR ?? 'no result')}`)
  const ids: string[] = res.idlist ?? []
  const runs: SraRun[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const r = (await eutils(client, 'esummary.fcgi', { db: 'sra', id: ids.slice(i, i + 200).join(',') }, requests)).result ?? {}
    for (const id of ids.slice(i, i + 200)) if (r[id]) runs.push(...parseSraSummary(r[id]))
  }
  return { source: 'NCBI SRA', retrieved, query: requests[0]!, requests, taxon, experiments: { total: Number(res.count ?? ids.length), listed: ids.length }, runs }
}

// --- BioSample ---------------------------------------------------------------------------------------------------

/** Attributes passed on. Anything else (contacts, owners, providers, free-text notes, coordinates) is never read. */
export const BIOSAMPLE_ATTRIBUTES = ['isolate', 'breed', 'sex', 'dev_stage', 'tissue', 'sample_type', 'specimen_voucher', 'geo_loc_name', 'country', 'collection_date', 'isolation_source', 'host'] as const

/** Attribute names that hold coordinates. Dropped without reading their values. */
const COORDINATE_NAME = /(^|[_\s])(lat|long?|latitude|longitude|coords?|coordinates?|gps|geo_?point|utm|easting|northing)([_\s]|$)/i
/** Values that look like coordinates, in any attribute: decimal pairs, hemisphere letters, degrees and minutes. */
const COORDINATE_VALUE = /-?\d{1,3}\.\d+\s*°?\s*[NSns]?\s*[,;\s]\s*-?\d{1,3}\.\d+\s*°?\s*[EWew]?|\d{1,3}\.\d+\s*°?\s*[NSns]\b|\d{1,3}\.\d+\s*°?\s*[EWew]\b|\d{1,3}\s*°\s*\d{1,2}|\d{1,3}\s*[°d]\s*\d{1,2}\s*['′m]/

/** BioSample's words for "no value". Left out rather than shown as if they were one. */
const PLACEHOLDER = /^(missing|not (collected|applicable|provided|available)|unknown|n\/?a|none|restricted access)$/i

export function looksLikeCoordinates(value: string): boolean {
  return COORDINATE_VALUE.test(value)
}

export type BioSample = {
  accession: string
  organism?: string
  taxid?: string
  /** As BioSample gives it, YYYY/MM/DD. */
  published?: string
  package?: string
  /** Only the names in `BIOSAMPLE_ATTRIBUTES`, keyed by harmonized name. */
  attributes: Partial<Record<(typeof BIOSAMPLE_ATTRIBUTES)[number], string>>
  /** Attributes left out because they hold coordinates. Names only; the values are never kept. */
  withheld: string[]
}

export type BioSampleListing = Provenance & {
  samples: BioSample[]
  /** Accessions asked for that BioSample didn't return. */
  missing: string[]
}

/** Parses one BioSample esummary document. Coordinates are dropped here, so nothing after this can see them. */
export function parseBioSample(doc: Record<string, any>): BioSample {
  const attributes: BioSample['attributes'] = {}
  const withheld: string[] = []
  const allowed = new Set<string>(BIOSAMPLE_ATTRIBUTES)
  for (const m of String(doc.sampledata ?? '').matchAll(/<Attribute\b([^>]*)>([^<]*)<\/Attribute>/g)) {
    const name = /\bharmonized_name="([^"]+)"/.exec(m[1]!)?.[1] ?? /\battribute_name="([^"]+)"/.exec(m[1]!)?.[1]
    if (!name) continue
    if (COORDINATE_NAME.test(name)) { withheld.push(name); continue }
    if (!allowed.has(name)) continue
    const value = decode(m[2]!)
    if (looksLikeCoordinates(value)) { withheld.push(name); continue }
    if (value && !PLACEHOLDER.test(value)) attributes[name as keyof BioSample['attributes']] = value
  }
  return {
    accession: String(doc.accession),
    ...(doc.organism ? { organism: String(doc.organism) } : {}),
    ...(doc.taxonomy ? { taxid: String(doc.taxonomy) } : {}),
    ...(doc.publicationdate ? { published: String(doc.publicationdate) } : {}),
    ...(doc.package ? { package: String(doc.package) } : {}),
    attributes,
    withheld: [...new Set(withheld)].sort(),
  }
}

/**
 * BioSamples by accession (SAMN, SAME, SAMD), with a short list of descriptive attributes. Coordinates (`lat_lon` and
 * the like, or any value shaped like one) are dropped at parse time and never returned or stored; `withheld` names
 * what was left out. Contacts and owners are never read.
 */
export async function biosampleFor(client: NcbiClient, accessions: string[], options: { at?: string } = {}): Promise<BioSampleListing> {
  const requests: string[] = []
  const retrieved = options.at ?? new Date().toISOString()
  const wanted = [...new Set(accessions.map((a) => a.trim()).filter(Boolean))]
  for (const a of wanted) if (!/^SAM[NED][A-Z]?\d+$/.test(a)) throw new AcquireError(`${a} isn't a BioSample accession`)
  const samples: BioSample[] = []
  for (let i = 0; i < wanted.length; i += 100) {
    const chunk = wanted.slice(i, i + 100)
    const search = await eutils(client, 'esearch.fcgi', { db: 'biosample', term: chunk.map((a) => `${a}[accn]`).join(' OR '), retmax: String(chunk.length * 2) }, requests)
    const ids: string[] = search.esearchresult?.idlist ?? []
    if (!ids.length) continue
    const r = (await eutils(client, 'esummary.fcgi', { db: 'biosample', id: ids.join(',') }, requests)).result ?? {}
    for (const id of ids) if (r[id]?.accession) samples.push(parseBioSample(r[id]))
  }
  const got = new Set(samples.map((s) => s.accession))
  return { source: 'NCBI BioSample', retrieved, query: requests[0] ?? eutilsUrl('esearch.fcgi', { db: 'biosample' }), requests, samples, missing: wanted.filter((a) => !got.has(a)) }
}

// --- NCBI Datasets genomes ---------------------------------------------------------------------------------------

export type GenomeSummary = {
  accession: string
  /** GenBank (GCA) or RefSeq (GCF). */
  database: 'genbank' | 'refseq' | 'unknown'
  /** The same assembly in the other database, if any. */
  pairedAccession?: string
  organism?: string
  taxid?: string
  assemblyName?: string
  /** Contig, Scaffold, Chromosome or Complete Genome. */
  assemblyLevel?: string
  status?: string
  /** Total sequence length in bases. */
  length?: number
  released?: string
  /** Organelles the report lists, such as Mitochondrion. */
  organelles: string[]
  /**
   * Whether this report lists a mitochondrial sequence. `not listed` doesn't mean the assembly has none: one of a
   * GenBank and RefSeq pair often lists it when the other doesn't, so check `pairedAccession` too.
   */
  mitogenome: 'listed' | 'not listed'
}

export type GenomeListing = Provenance & { taxon: string; total: number; genomes: GenomeSummary[] }

/** One NCBI Datasets genome report. Only these fields are read; the embedded BioSample (with any coordinates) is not. */
export function parseGenomeReport(r: Record<string, any>): GenomeSummary {
  const info = r.assembly_info ?? {}
  const organelles = [...new Set<string>((r.organelle_info ?? []).map((o: any) => String(o.description ?? '')).filter(Boolean))]
  const db = String(r.source_database ?? '')
  const length = Number(r.assembly_stats?.total_sequence_length)
  return {
    accession: String(r.accession),
    database: /REFSEQ/i.test(db) ? 'refseq' : /GENBANK/i.test(db) ? 'genbank' : 'unknown',
    ...(r.paired_accession ? { pairedAccession: String(r.paired_accession) } : info.paired_assembly?.accession ? { pairedAccession: String(info.paired_assembly.accession) } : {}),
    ...(r.organism?.organism_name ? { organism: String(r.organism.organism_name) } : {}),
    ...(r.organism?.tax_id ? { taxid: String(r.organism.tax_id) } : {}),
    ...(info.assembly_name ? { assemblyName: String(info.assembly_name) } : {}),
    ...(info.assembly_level ? { assemblyLevel: String(info.assembly_level) } : {}),
    ...(info.assembly_status ? { status: String(info.assembly_status) } : {}),
    ...(Number.isFinite(length) && length > 0 ? { length } : {}),
    ...(info.release_date ? { released: String(info.release_date) } : {}),
    organelles,
    mitogenome: organelles.some((o) => /mitochondri/i.test(o)) ? 'listed' : 'not listed',
  }
}

/**
 * Genome assemblies NCBI Datasets has for a taxon (an NCBI Taxonomy ID or a name), with subtaxa: accession, level,
 * size and whether a mitogenome is listed. A listing only; nothing is downloaded. Reads up to `maxPages` pages.
 */
export async function datasetsGenomes(fetch: FetchLike, taxon: string, options: SourceOptions & { pageSize?: number; maxPages?: number } = {}): Promise<GenomeListing> {
  const t = taxon.trim()
  if (!t) throw new AcquireError('Name a taxon')
  const f = pacedFor(fetch, options)
  const requests: string[] = []
  const retrieved = options.at ?? new Date().toISOString()
  const genomes: GenomeSummary[] = []
  let total = 0
  let token: string | undefined
  for (let page = 0; page < (options.maxPages ?? 10); page++) {
    const params = new URLSearchParams({ page_size: String(options.pageSize ?? 100), ...(token ? { page_token: token } : {}) })
    const body = await getJson(f, `${DATASETS}genome/taxon/${encodeURIComponent(t)}/dataset_report?${params}`, 'NCBI Datasets', requests)
    total = Number(body.total_count ?? 0)
    genomes.push(...(body.reports ?? []).filter((r: any) => r.accession).map(parseGenomeReport))
    token = body.next_page_token
    if (!token) break
  }
  return { source: 'NCBI Datasets', retrieved, query: requests[0]!, requests, taxon: t, total, genomes }
}

// --- Occurrence coverage -----------------------------------------------------------------------------------------

export type Count = { name: string; count: number }

export type Coverage = Provenance & {
  /** The taxon as the service matched it. */
  matched: { name: string; key?: string; rank?: string; matchType?: string }
  total: number
  /** Country as the service gives it: ISO codes for GBIF, verbatim lowercase text for iDigBio, names for BOLD. */
  byCountry: Count[]
  /** Records with no country, where the service makes that knowable. */
  noCountry?: number
  byBasisOfRecord: Count[]
  /** Licences of the records counted, with counts. `null` where the service doesn't say. */
  licences: Count[] | null
  datasets?: number
  notes: string[]
}

export type OccurrenceCoverage = { taxon: string; gbif: Coverage | null; idigbio: Coverage | null; failed: string[] }

const facet = (facets: any[], field: string): Count[] =>
  ((facets ?? []).find((f) => f.field === field)?.counts ?? []).map((c: any) => ({ name: String(c.name), count: Number(c.count) })).sort((a: Count, b: Count) => b.count - a.count || a.name.localeCompare(b.name))
const sum = (counts: Count[]) => counts.reduce((n, c) => n + c.count, 0)

/**
 * GBIF occurrence counts for a scientific name: by country, by basis of record and by licence, with how many datasets
 * they come from. Two requests, the name match and one search with `limit=0`, so no record (and no coordinate) is
 * ever fetched. A name GBIF can't match exactly to a species or lower is refused, never counted at a higher rank.
 */
export async function gbifCoverage(fetch: FetchLike, name: string, options: SourceOptions = {}): Promise<Coverage> {
  const n = name.trim()
  if (!n) throw new AcquireError('Name a taxon')
  const f = pacedFor(fetch, options)
  const requests: string[] = []
  const retrieved = options.at ?? new Date().toISOString()
  const m = await getJson(f, `${GBIF}species/match?${new URLSearchParams({ name: n })}`, 'GBIF', requests)
  if (!m.usageKey || m.matchType === 'NONE') throw new AcquireError(`GBIF has no match for ${n}`)
  if (m.matchType === 'HIGHERRANK') throw new AcquireError(`GBIF matched ${n} only at a higher rank (${m.rank} ${m.canonicalName ?? m.scientificName}). Not counted`)
  const key = String(m.usageKey)
  const params = new URLSearchParams({ taxonKey: key, limit: '0' })
  for (const fct of ['country', 'basisOfRecord', 'license', 'datasetKey']) params.append('facet', fct)
  params.set('facetLimit', '300')
  params.set('datasetKey.facetLimit', '1000')
  const url = `${GBIF}occurrence/search?${params}`
  const body = await getJson(f, url, 'GBIF', requests)
  const total = Number(body.count ?? 0)
  const byCountry = facet(body.facets, 'COUNTRY')
  const datasets = facet(body.facets, 'DATASET_KEY').length
  const notes = ['Counts include synonyms and subtaxa GBIF files under this name.', 'LIVING_SPECIMEN is an animal in a zoo or collection, not a wild record.']
  if (m.matchType !== 'EXACT') notes.unshift(`GBIF matched "${n}" to ${m.scientificName} (${m.matchType}). Check it's the taxon you meant.`)
  if (datasets >= 1000) notes.push('At least 1000 datasets; the count stops there.')
  return {
    source: 'GBIF', retrieved, query: url, requests,
    matched: { name: String(m.scientificName ?? n), key, ...(m.rank ? { rank: String(m.rank) } : {}), ...(m.matchType ? { matchType: String(m.matchType) } : {}) },
    total, byCountry, noCountry: Math.max(0, total - sum(byCountry)), byBasisOfRecord: facet(body.facets, 'BASIS_OF_RECORD'),
    licences: facet(body.facets, 'LICENSE'), datasets, notes,
  }
}

const topCounts = (o: Record<string, any> | undefined): Count[] =>
  Object.entries(o ?? {}).filter(([k, v]) => k !== 'itemCount' && v && typeof v === 'object').map(([k, v]) => ({ name: k, count: Number(v.itemCount ?? 0) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

/**
 * iDigBio record counts for a scientific name, by country and basis of record, from its summary endpoint: no record
 * is fetched. iDigBio doesn't index a licence per record, so `licences` is `null` rather than guessed.
 */
export async function idigbioCoverage(fetch: FetchLike, name: string, options: SourceOptions = {}): Promise<Coverage> {
  const n = name.trim()
  if (!n) throw new AcquireError('Name a taxon')
  const f = pacedFor(fetch, options)
  const requests: string[] = []
  const retrieved = options.at ?? new Date().toISOString()
  const rq = JSON.stringify({ scientificname: n.toLowerCase() })
  const top = (field: string, count: number) => `${IDIGBIO}summary/top/records/?${new URLSearchParams({ rq, top_fields: JSON.stringify([field]), count: String(count) })}`
  const countries = await getJson(f, top('country', 300), 'iDigBio', requests)
  const basis = await getJson(f, top('basisofrecord', 50), 'iDigBio', requests)
  const total = Number(countries.itemCount ?? 0)
  const byCountry = topCounts(countries.country)
  return {
    source: 'iDigBio', retrieved, query: requests[0]!, requests,
    matched: { name: n.toLowerCase(), matchType: 'scientificname' },
    total, byCountry, noCountry: Math.max(0, total - sum(byCountry)), byBasisOfRecord: topCounts(basis.basisofrecord), licences: null,
    notes: [
      'Countries are as the records spell them, so one country can appear under several names.',
      'Matched on the scientific name as written on records; synonyms are not included.',
      "iDigBio doesn't index a licence per record. Each recordset states its own rights.",
    ],
  }
}

/**
 * Where a taxon has been recorded: GBIF and, unless turned off, iDigBio. Counts only, never coordinates or records.
 * A service that fails is listed in `failed`, so a missing count never reads as zero. iDigBio publishes to GBIF, so
 * the two overlap and shouldn't be added together.
 */
export async function occurrenceCoverage(fetch: FetchLike, name: string, options: SourceOptions & { idigbio?: boolean } = {}): Promise<OccurrenceCoverage> {
  const failed: string[] = []
  const attempt = async (service: string, work: () => Promise<Coverage>) => {
    try { return await work() } catch (e) { failed.push(`${service}: ${(e as Error).message}`); return null }
  }
  const at = options.at ?? new Date().toISOString()
  const gbif = await attempt('GBIF', () => gbifCoverage(fetch, name, { ...options, at }))
  const idigbio = options.idigbio === false ? null : await attempt('iDigBio', () => idigbioCoverage(fetch, name, { ...options, at }))
  return { taxon: name.trim(), gbif, idigbio, failed }
}

// --- BOLD --------------------------------------------------------------------------------------------------------

export type BoldCoverage = Provenance & {
  matched: string
  /** Records by country or ocean, as BOLD names them, including its own "Unrecoverable". */
  byCountry: Count[]
  /** Records by marker, such as COI-5P. A record can carry more than one. */
  byMarker: Count[]
  notes: string[]
}

/**
 * BOLD record counts for a taxon by country and by marker, from the public portal's documented summary endpoint. Two
 * requests: resolving the name, then the summary. No records or coordinates are fetched.
 */
export async function boldCoverage(fetch: FetchLike, name: string, options: SourceOptions = {}): Promise<BoldCoverage> {
  const n = name.trim().replace(/[;:]/g, ' ')
  if (!n.trim()) throw new AcquireError('Name a taxon')
  const f = pacedFor(fetch, options)
  const requests: string[] = []
  const retrieved = options.at ?? new Date().toISOString()
  const pre = await getJson(f, `${BOLD}query/preprocessor?${new URLSearchParams({ query: `tax:${n}` })}`, 'BOLD', requests)
  const matched: string | undefined = (pre.successful_terms ?? []).map((t: any) => t.matched).find((t: unknown) => typeof t === 'string' && t.startsWith('tax:'))
  if (!matched) throw new AcquireError(`BOLD has no taxon named ${n}`)
  const url = `${BOLD}summary?${new URLSearchParams({ query: matched, fields: 'country/ocean,marker_code' })}`
  const body = await getJson(f, url, 'BOLD', requests)
  const counts = (o: Record<string, unknown> | undefined): Count[] => Object.entries(o ?? {}).map(([k, v]) => ({ name: k, count: Number(v) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return {
    source: 'BOLD', retrieved, query: url, requests, matched,
    byCountry: counts(body['country/ocean']), byMarker: counts(body.marker_code),
    notes: ["BOLD's summary gives no total or licence, so neither is reported. Check BOLD's terms before reusing its records."],
  }
}
