import { reverseComplement } from './sequence.js'
import { sha256Hex } from './sha256.js'
import type { ExternalId, Publication, SequenceRecord } from './model.js'

export type GenBankFeature = { key: string; location: string; qualifiers: Record<string, string[]> }

export type GenBankRecord = {
  accession: string
  version: string
  definition: string
  organism: string
  lineage: string[]
  references: Publication[]
  features: GenBankFeature[]
  sequence: string
}

const unquote = (v: string) => v.replace(/^"/, '').replace(/"$/, '').replace(/""/g, '"')

/** Parses GenBank flat files. Nothing is dropped or inferred: absent values stay absent. */
export function parseGenBank(text: string): GenBankRecord[] {
  const blocks = text.split(/^\/\/\s*$/m).filter((b) => b.includes('LOCUS'))
  return blocks.map(parseOne)
}

function parseOne(block: string): GenBankRecord {
  const lines = block.split(/\r?\n/)
  const rec: GenBankRecord = { accession: '', version: '', definition: '', organism: '', lineage: [], references: [], features: [], sequence: '' }
  let section = ''
  let sub = ''
  let ref: Publication | null = null
  let feature: GenBankFeature | null = null
  let qualifier: string | null = null
  const lineageParts: string[] = []
  const seq: string[] = []
  const add = (o: Publication, k: keyof Publication, v: string) => { o[k] = o[k] ? `${o[k]} ${v}` : v }
  for (const line of lines) {
    const top = /^([A-Z]+)\s*(.*)$/.exec(line)
    if (top) {
      section = top[1]!
      sub = ''
      qualifier = null
      const rest = top[2]!.trim()
      if (section === 'DEFINITION') rec.definition = rest
      else if (section === 'ACCESSION') rec.accession = rest.split(/\s+/)[0] ?? ''
      else if (section === 'VERSION') rec.version = rest.split(/\s+/)[0] ?? ''
      else if (section === 'REFERENCE') { ref = {}; rec.references.push(ref) }
      continue
    }
    if (section === 'DEFINITION') rec.definition += ` ${line.trim()}`
    else if (section === 'SOURCE') {
      const m = /^ {2}ORGANISM\s+(.*)$/.exec(line)
      if (m) { rec.organism = m[1]!.trim(); sub = 'ORGANISM' }
      else if (sub === 'ORGANISM' && line.trim()) lineageParts.push(line.trim())
    } else if (section === 'REFERENCE' && ref) {
      const m = /^ {2}([A-Z]+)\s+(.*)$/.exec(line)
      const key = m?.[1] ?? sub
      const value = (m?.[2] ?? line).trim()
      sub = key
      if (key === 'AUTHORS') add(ref, 'authors', value)
      else if (key === 'TITLE') add(ref, 'title', value)
      else if (key === 'JOURNAL') add(ref, 'journal', value)
      else if (key === 'PUBMED') ref.pubmedId = value
    } else if (section === 'FEATURES') {
      const head = /^ {5}(\S+)\s+(\S.*)$/.exec(line)
      if (head) {
        feature = { key: head[1]!, location: head[2]!.trim(), qualifiers: {} }
        rec.features.push(feature)
        qualifier = null
        continue
      }
      const body = line.trim()
      if (!feature || !body) continue
      const q = /^\/([A-Za-z_0-9]+)(?:=(.*))?$/.exec(body)
      if (q) {
        qualifier = q[1]!
        ;(feature.qualifiers[qualifier] ??= []).push(q[2] ?? '')
      } else if (qualifier) {
        const list = feature.qualifiers[qualifier]!
        const joiner = qualifier === 'translation' ? '' : ' '
        list[list.length - 1] += joiner + body
      } else feature.location += body
    } else if (section === 'ORIGIN') seq.push(line.replace(/[^A-Za-z]/g, ''))
  }
  rec.lineage = lineageParts.join(' ').replace(/\.$/, '').split(';').map((s) => s.trim()).filter(Boolean)
  rec.sequence = seq.join('').toUpperCase()
  for (const f of rec.features) for (const k of Object.keys(f.qualifiers)) f.qualifiers[k] = f.qualifiers[k]!.map(unquote)
  rec.references = rec.references.filter((r) => r.title !== 'Direct Submission')
  return rec
}

/** Extracts a feature's bases from a location such as `<1..>719`, `join(1..5,8..9)` or `complement(3..7)`. */
export function extractLocation(sequence: string, location: string): string {
  const loc = location.trim()
  const fn = /^(complement|join|order)\((.*)\)$/.exec(loc)
  if (fn) {
    if (fn[1] === 'complement') return reverseComplement(extractLocation(sequence, fn[2]!))
    return splitTopLevel(fn[2]!).map((p) => extractLocation(sequence, p)).join('')
  }
  const range = /^<?(\d+)(?:\.\.>?(\d+))?$/.exec(loc)
  if (!range) throw new Error(`Unsupported GenBank location: ${location}`)
  const start = Number(range[1])
  const end = Number(range[2] ?? range[1])
  return sequence.slice(start - 1, end)
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' }
    else cur += ch
  }
  parts.push(cur)
  return parts
}

/** Features naming a gene, matched exactly on /gene or /product (never by substring). */
export function findGeneFeatures(rec: GenBankRecord, names: string[], key = 'CDS'): GenBankFeature[] {
  const wanted = new Set(names.map((n) => n.toLowerCase()))
  return rec.features.filter((f) => f.key === key && [...(f.qualifiers.gene ?? []), ...(f.qualifiers.product ?? [])].some((v) => wanted.has(v.toLowerCase())))
}

/** Flattens a parsed record for the record sheet. Provenance starts unknown until a curator or paper says otherwise. */
export function toSequenceRecord(rec: GenBankRecord): SequenceRecord {
  const source = rec.features.find((f) => f.key === 'source')?.qualifiers ?? {}
  const taxon = (source.db_xref ?? []).find((x) => x.startsWith('taxon:'))?.slice(6)
  const taxonId: ExternalId | undefined = taxon ? { source: 'ncbi-taxonomy', id: taxon } : undefined
  return {
    id: rec.version || rec.accession,
    accession: rec.accession,
    version: rec.version,
    definition: rec.definition,
    organism: rec.organism,
    ...(taxonId ? { taxon: taxonId } : {}),
    lineage: rec.lineage,
    ...(source.isolate?.[0] ? { isolate: source.isolate[0] } : {}),
    ...(source.specimen_voucher?.[0] ? { voucher: source.specimen_voucher[0] } : {}),
    ...(source.geo_loc_name?.[0] ?? source.country?.[0] ? { geoLocName: source.geo_loc_name?.[0] ?? source.country?.[0] } : {}),
    ...(source.lat_lon?.[0] ? { latLon: source.lat_lon[0] } : {}),
    ...(source.collection_date?.[0] ? { collectionDate: source.collection_date[0] } : {}),
    publications: rec.references,
    sequenceLength: rec.sequence.length,
    sequenceSha256: `sha256:${sha256Hex(rec.sequence)}`,
    provenanceClass: 'unknown',
  }
}
