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
