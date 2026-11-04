/** Records are plain JSON: ISO date strings, no classes. See docs/architecture/data-schema.md. */
export type Id = string

/** An identifier qualified by the system that issued it, such as an NCBI taxon id. */
export type ExternalId = { source: string; id: string }

/** Problems are reported, never silently repaired. */
export type Diagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  path?: string
  ids?: Id[]
}

/** What is known about how an animal or specimen came to be sampled. `unknown` is a real value. */
export type ProvenanceClass = 'wild-documented' | 'museum-documented' | 'seized' | 'ex-situ' | 'zoo' | 'unknown'

/** Where a field's value came from, so every claim can be traced. */
export type FieldSource = { kind: 'genbank' | 'publication' | 'supplement' | 'curator' | 'user'; citation?: string; retrievedAt?: string }

export type Publication = { authors?: string; title?: string; journal?: string; pubmedId?: string }

export type SequenceRecord = {
  id: Id
  accession: string
  version: string
  definition?: string
  organism?: string
  taxon?: ExternalId
  lineage?: string[]
  isolate?: string
  voucher?: string
  geoLocName?: string
  /** Precise coordinates are sensitive: never written to public sheets or panels by default. */
  latLon?: string
  collectionDate?: string
  publications: Publication[]
  sequenceLength: number
  sequenceSha256: string
  provenanceClass: ProvenanceClass
}

/** A saved, reusable choice of evidence. Holds no species knowledge in code: everything comes from configuration. */
export type Selection = {
  id: Id
  title: string
  /** Ingroup taxa as source-qualified ids, for example from NCBI Taxonomy or OneTaxonomy. */
  taxa: ExternalId[]
  marker: { kind: 'gene' | 'mitogenome' | 'snp'; gene?: string; synonyms?: string[] }
  outgroups: { accession?: string; taxon?: ExternalId; rationale?: string }[]
  exclude: { accession: string; reason: string }[]
  filters: { minLength?: number; maxLength?: number; maxAmbiguous?: number; provenanceClasses?: ProvenanceClass[] }
}

/** How to run a selection. Every value that was once hardcoded lives here. */
export type Profile = {
  schemaVersion: 1
  id: Id
  title: string
  selection: Selection
  reference?: { accession: string; codonStart?: number; geneticCode?: GeneticCode }
  tree?: { model: string; bootstrap: number; shAlrt: number; seed: number; threads: number }
}

export type GeneticCode = 1 | 2

export type Marker = Selection['marker']

/** An immutable download: what was fetched, from where, with hashes of the raw files. */
export type Snapshot = {
  schemaVersion: 1
  id: Id
  createdAt: string
  sources: { name: string; query?: string; retrievedAt: string }[]
  records: SequenceRecord[]
  rawFiles: { path: string; sha256: string }[]
  checksum?: string
}

export type RunEvent = {
  at: string
  level: 'debug' | 'info' | 'warning' | 'error'
  step: string
  message: string
  data?: Record<string, unknown>
}

/** What actually happened. Runs are never edited; a correction is a new run. */
export type Run = {
  schemaVersion: 1
  id: Id
  profile: Profile
  snapshot?: { id: Id; checksum: string }
  tools: { name: string; version: string; sha256?: string }[]
  seed?: number
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt?: string
  events: RunEvent[]
  outputs: { path: string; sha256: string }[]
  diagnostics: Diagnostic[]
}

/** Half-open reference coordinates: `start` is included, `end` is not. */
export type PanelWindow = {
  start: number
  end: number
  diagnosticSites: { position: number; bases: string }[]
}

/** How a reference record may be used. Records assigned by sequence can never show where a group occurs. */
export type EvidenceUse = 'lineage-and-location' | 'lineage-only'

export type PanelGroup = {
  id: Id
  label: string
  /** A generalized named region. Panels never hold coordinates. */
  region?: string
  windows: PanelWindow[]
  evidence: { record: Id; use: EvidenceUse; provenanceClass: ProvenanceClass }[]
}

export type PanelStatus = 'candidate' | 'active' | 'superseded' | 'withdrawn'

/** An immutable reference panel, exported as this JSON with sequences in FASTA beside it. */
export type Panel = {
  schemaVersion: 1
  id: Id
  version: string
  checksum?: string
  status: PanelStatus
  taxa: ExternalId[]
  marker: Marker
  reference: { accession: string; length: number; codonStart?: number; geneticCode?: GeneticCode }
  groups: PanelGroup[]
  /** Regions, populations or windows this panel can't speak to. Reports must carry them. */
  notCovered: string[]
  /** The claims this panel has been validated for. Empty means none yet. */
  validatedScope: string[]
  sources: { citation: string; url?: string }[]
  builtBy: Id
}

export type Query = { id: Id; sequence: string; source: string; sha256: string; taxonClaim?: ExternalId }

export type FindingStatus = 'consistent' | 'excluded_within_panel' | 'not_evaluable' | 'inconclusive' | 'novel_or_unsampled_flag'

export type Finding = {
  group: Id
  status: FindingStatus
  reason: string
  /** Sites this group could be compared on. */
  overlap: number
  differences?: number
  evidence: Id[]
}

/** One query against one exact panel version. Stored verbatim wherever it travels. */
export type Result = {
  schemaVersion: 1
  query: Id
  panel: { id: Id; version: string; checksum: string }
  run: Id
  overlap: number
  findings: Finding[]
  caveats: string[]
}
