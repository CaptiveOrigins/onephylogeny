import type { GateSettings } from './gates.js'
import type { QcSettings, SampleQc } from './qc.js'

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
export type ProvenanceClass =
  /** Independently documented as collected in the wild at this place. */
  | 'wild-documented'
  /** A museum specimen with documented collection data. */
  | 'museum-documented'
  /** A source reports where this animal came from, and nobody here has confirmed it. Needs `originSource`. */
  | 'origin-reported'
  | 'seized' | 'ex-situ' | 'zoo' | 'unknown'

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
/** Which Study state a fetch or panel came from, and what that state left out after results were seen. */
export type StudyLink = { id: Id; title: string; stateHash: string; postHocOmitted: string[] }

export type Selection = {
  id: Id
  title: string
  /** Ingroup taxa as source-qualified ids, for example from NCBI Taxonomy or OneTaxonomy. */
  taxa: ExternalId[]
  marker: { kind: 'gene' | 'mitogenome' | 'snp'; gene?: string; synonyms?: string[]; products?: string[]; organelle?: 'mitochondrion' | 'plastid' }
  outgroups: { accession?: string; taxon?: ExternalId; rationale?: string }[]
  exclude: { accession: string; reason: string }[]
  /** Fetch exactly these accessions instead of searching, as chosen in a Study. Every record still goes through the same checks. */
  include?: string[]
  /** The Study that chose them. Doesn't affect what's fetched, so it stays out of artifact keys. */
  fromStudy?: StudyLink
  filters: { minLength?: number; maxLength?: number; maxAmbiguous?: number; provenanceClasses?: ProvenanceClass[] }
}

/** How to run a selection. Every value that was once hardcoded lives here. */
export type Profile = {
  schemaVersion: 1
  id: Id
  title: string
  selection: Selection
  /** Overrides for the record checks. Whatever applied is sealed into any panel built from them. */
  gates?: Partial<GateSettings>
  reference?: { accession: string; codonStart?: number; geneticCode?: GeneticCode }
  tree?: { model: string; bootstrap: number; shAlrt: number; seed: number; threads: number }
  panel?: PanelSettings
}

/** How to build and read a panel. Groups and thresholds are always configuration, never code. */
export type PanelSettings = {
  id: Id
  version: string
  groups: { id: Id; label: string; region?: string; ecoregions?: number[] }[]
  notCovered: string[]
  validatedScope: string[]
  /** Named stretches of the reference, usually where amplicons fall. Without them the whole marker is one window. */
  windows?: PanelWindow[]
  rules: EvaluationRules
  /** How hard to test claims. Fewer shuffles or simulations can't reach the gates' p-value. */
  controls?: { shuffles?: number; simulations?: number; seed?: number }
  /** Sample QC thresholds sealed into the panel. Without them, OnePhylogeny's stated defaults apply. */
  qc?: QcSettings
}

/** How to read a panel. Uncalibrated, stated values: none of this is a probability. */
export type EvaluationRules = {
  /** Fewer columns than this, shared with a group's well-covered columns in a window, means not evaluable there. */
  minSharedColumns: number
  /** A column counts for a group only with at least this many records. One record never makes a group comparable. */
  minDepthPerColumn: number
  /** Independent sampling sites a group needs at a column before a conflict there can rule it out. */
  minBlocksForExclusion: number
  /** Sites favoring one side, with none favoring the other, needed to resolve a pair of groups. */
  minDecisiveSites: number
  /** Differences allowed beyond a group's own spread, scaled to the columns compared. */
  tolerance: number
}

/** Human decisions about records, kept apart from what sources say. Every decision can carry a note. */
export type Curation = {
  schemaVersion: 1
  records: Record<string, RecordDecision>
}

export type RecordDecision = {
  group?: Id
  provenanceClass?: ProvenanceClass
  use?: EvidenceUse
  /** Sampling site or block, used so validation never tests a record against its own site. */
  site?: string
  /** The paper or submission this record comes from. Defaults to the title on its source record. */
  study?: string
  /** The source of a reported origin, such as a paper's table. Required for `origin-reported`. */
  originSource?: string
  exclude?: boolean
  note?: string
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
  kind: 'fetch' | 'panel' | 'sample' | 'tree'
  profile: Profile
  /** The typed, content-addressed outputs of this run, each traceable to its inputs. */
  artifacts: { type: string; key: string; reused: boolean }[]
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

/** A named stretch of the reference, the same for every group. Half-open: `start` is included, `end` is not. */
export type PanelWindow = { id: Id; label: string; start: number; end: number }

/** What one group has in one window. A group short of depth is reported as data, never left out. */
export type GroupCoverage = {
  window: Id
  records: number
  blocks: number
  /** Half-open runs of columns with enough records. */
  columnsAtDepth: [number, number][]
  /** The largest differences-per-column from any haplotype to its nearest groupmate here. Null if nothing could be compared. */
  spreadRate: number | null
  /** How many more records would bring this window's best column up to depth. */
  recordsNeeded: number
}

export type PairSide = { a: number; b: number }

/** A column where two groups share no possible base, in records that can show location. */
export type PairSite = {
  position: number
  a: string
  b: string
  depth: PairSide
  blocks: PairSide
  /** 95% upper bound on the share of a group carrying a state not seen here, `1 - 0.05^(1/n)`. Optimistic: it treats records as independent. */
  unseenUpper95: PairSide
}

/** Two groups in one window. `not_evaluable` is kept as data, because an empty list of sites alone is ambiguous. */
export type PanelPair = {
  a: Id
  b: Id
  window: Id
  state: 'resolvable' | 'no_fixed_sites' | 'not_evaluable'
  reason?: string
  records: PairSide
  blocks: PairSide
  sites: PairSite[]
}

/** How a reference record may be used. Records assigned by sequence can never show where a group occurs. */
export type EvidenceUse = 'lineage-and-location' | 'lineage-only'

export type PanelGroup = {
  id: Id
  label: string
  /** A generalized named region. Panels never hold coordinates. */
  region?: string
  /**
   * The RESOLVE Ecoregions 2017 IDs (`ECO_ID`) this group's region covers, for the region map (owner, 2026-11-10;
   * ADR 0008). Whole ecoregions only, so a map never shows anything finer than the region already names.
   */
  ecoregions?: number[]
  coverage: GroupCoverage[]
  /** `block` is an opaque label, so a panel doesn't reveal sampling sites. */
  evidence: { record: Id; use: EvidenceUse; provenanceClass: ProvenanceClass; originSource?: string; block?: string; study?: string }[]
}

/** A pair of groups in one window that passed every gate. `exploratory` until a test meeting the protocol's section 2 runs. */
export type ValidatedClaim = { a: Id; b: Id; window: Id; minColumns: number; sites: { a: number; b: number }; basis: 'exploratory' | 'confirmatory' }

export type PanelStatus = 'candidate' | 'active' | 'superseded' | 'withdrawn'

/** An immutable reference panel, exported as this JSON with sequences in FASTA beside it. */
export type Panel = {
  schemaVersion: 2
  id: Id
  version: string
  checksum?: string
  status: PanelStatus
  taxa: ExternalId[]
  marker: Marker
  reference: { accession: string; length: number; codonStart?: number; geneticCode?: GeneticCode }
  windows: PanelWindow[]
  groups: PanelGroup[]
  /** Every pair of groups in every window. Derived from sequences and rules, and derived again on load. */
  pairs: PanelPair[]
  /** Regions, populations or windows this panel can't speak to. Reports must carry them. */
  notCovered: string[]
  /** The claims this panel has been validated for, in words. Empty means none yet. */
  validatedScope: string[]
  /** The same claims in a form results can check. Only the validation report fills these. */
  claims: ValidatedClaim[]
  sources: { citation: string; url?: string }[]
  builtBy: Id
  /** Part of the sealed panel, so editing a profile can never change what a panel version concludes. */
  rules: EvaluationRules
  /** The record checks its members passed, sealed so a sample is held to the same checks. */
  gates: GateSettings
  /** Sample QC thresholds, sealed so every sample gets the same QC. Absent means the stated defaults. */
  qc?: QcSettings
  /** Nuclear copies of the marker from a genome screen, so every sample is checked against the same ones. Absent if no screen ran. */
  numtCopies?: { id: string; aligned: string }[]
  /** The Study state behind this panel, sealed so post hoc omissions travel with its results. */
  study?: StudyLink
  /** Hash of the aligned sequences and reference that travel beside this JSON, so the seal covers them too. */
  sequencesChecksum: string
  /** What made this panel. */
  builtWith?: { name: string; version: string }[]
}

export type Query = { id: Id; sequence: string; source: string; sha256: string; taxonClaim?: ExternalId }

export type FindingStatus = 'consistent' | 'excluded_within_panel' | 'not_evaluable' | 'inconclusive'

/** Why a group got the status it did, in a form code can count. */
export type FindingReason =
  | 'within-spread'
  | 'contradicted-outside-spread'
  /** Within the group's spread, yet decisive sites favor another group. */
  | 'contradicted-within-spread'
  /** Further than the group's spread, with no decisive sites against it. */
  | 'outside-spread-not-contradicted'
  | 'no-location-evidence'
  /** No column in the query's windows has enough records. */
  | 'too-few-records'
  | 'too-few-shared-columns'

export type FindingWindow = { window: Id; sharedColumns: number; differences: number; unresolved: number; allowedDifferences: number; nearest: Id[] }

export type Finding = {
  group: Id
  status: FindingStatus
  reasonCode: FindingReason
  reason: string
  /** Columns compared, counting only those where this group has enough records. */
  overlap: number
  /** Columns where an ambiguity code could match or differ, so they neither support nor count against. */
  unresolved?: number
  differences?: number
  /** Differences per column over everything compared. Compare this, not raw counts, across groups with different coverage. */
  distance?: number
  /** Sites this query covers that separate this group from another. Many shared columns with none of these establish little. */
  informativeSites: number
  /** Independent sampling sites behind the columns compared. */
  blocks?: number
  /** More records this group needs before it can be compared here. */
  recordsNeeded?: number
  windows: FindingWindow[]
  evidence: Id[]
}

export type PairReason = 'decisive-sites' | 'group-not-evaluable' | 'no-sites-covered' | 'too-few-decisive-sites' | 'sites-disagree' | 'thin-group'

/** Whether this query separates two groups. `not_resolved` is a real answer: the columns it covers don't separate them. */
export type PairFinding = {
  a: Id
  b: Id
  state: 'resolved' | 'not_resolved' | 'not_evaluable'
  reasonCode: PairReason
  /** The group the decisive sites favor, when resolved. */
  favors?: Id
  sitesCovered: number
  forA: number
  forB: number
  /** Bases matching neither side, which may signal an unsampled population. */
  neither: number
  /** Ambiguity codes, counted for neither side. */
  ambiguous: number
}

/** Belongs to the query, not to a group: it never overwrites what was found about one. */
export type Novelty = {
  /** True when no evaluated group fits. A single unmatched base is reported but doesn't flag the query. */
  flagged: boolean
  reasons: ('no-consistent-group' | 'base-matching-neither-side')[]
  /** The evaluated group nearest by rate, when none fits. */
  closest?: Id
  neitherSideSites: number
}

/** One query against one exact panel version. Stored verbatim wherever it travels. */
export type Result = {
  schemaVersion: 2
  query: Id
  /** Hash of the exact sequence tested. */
  querySha256?: string
  /** What produced this result, in the spirit of reporting software and data versions with every call. */
  producedBy?: { name: string; version: string }[]
  panel: { id: Id; version: string; checksum: string }
  run: Id
  overlap: number
  findings: Finding[]
  pairs: PairFinding[]
  /** Groups with no finding either way. The true group could be one of these. */
  candidatesNotEvaluated: Id[]
  novelty: Novelty
  /** Why this result falls outside what the panel has been validated for. Empty means it's inside. */
  outOfValidatedScope: string[]
  caveats: string[]
  /** The sequence's quality by named rules (roadmap stage 4). It describes the sequence; it changes no status. */
  qc?: SampleQc
}
