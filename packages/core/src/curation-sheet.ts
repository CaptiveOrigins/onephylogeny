import type { Curation, Diagnostic, EvidenceUse, Id, ProvenanceClass, RecordDecision, SequenceRecord } from './model.js'

/**
 * The curation sheet (roadmap stage 3, bulk tools): the curation as a CSV a person can sort, filter and fill in a
 * spreadsheet, and read back with every change checked and counted. A few read-only columns from the record (organism,
 * length, title) help a person decide; they are never read back. Coordinates are never written.
 */
export const PROVENANCE_CLASSES: readonly ProvenanceClass[] = ['wild-documented', 'museum-documented', 'origin-reported', 'seized', 'ex-situ', 'zoo', 'unknown']
export const EVIDENCE_USES: readonly EvidenceUse[] = ['lineage-and-location', 'lineage-only']

/** Columns read back, in order. `record` is the key. */
const EDITABLE = ['group', 'provenance_class', 'use', 'site', 'study', 'origin_source', 'exclude', 'note'] as const
const CONTEXT = ['organism', 'length', 'title'] as const
export const CURATION_COLUMNS = ['record', ...EDITABLE, ...CONTEXT] as const

type Editable = (typeof EDITABLE)[number]
const FIELD: Record<Editable, keyof RecordDecision> = {
  group: 'group', provenance_class: 'provenanceClass', use: 'use', site: 'site', study: 'study', origin_source: 'originSource', exclude: 'exclude', note: 'note',
}

function cell(v: string | number | boolean | undefined): string {
  if (v === undefined || v === false) return ''
  let s = String(v)
  // Text must not run as a formula when the sheet is opened in a spreadsheet; the guard is removed on reading.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Every record in the run, in accession order, with its decision if it has one. */
export function curationToCsv(curation: Curation, records: SequenceRecord[] = []): string {
  const byId = new Map(records.map((r) => [r.version || r.accession, r]))
  const ids = [...new Set([...byId.keys(), ...Object.keys(curation.records)])].sort()
  const rows = [CURATION_COLUMNS.join(',')]
  for (const id of ids) {
    const d = curation.records[id] ?? {}
    const r = byId.get(id)
    rows.push([
      cell(id),
      ...EDITABLE.map((c) => cell(d[FIELD[c]] as string | boolean | undefined)),
      cell(r?.organism), cell(r?.sequenceLength), cell(r?.publications.map((p) => p.title).filter(Boolean).join(' | ') || r?.definition),
    ].join(','))
  }
  return `${rows.join('\n')}\n`
}

/** RFC 4180, with CRLF or LF line ends and a byte-order mark tolerated, as spreadsheets save them. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') { row.push(field); field = '' } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  if (quoted) throw new Error('The sheet ends inside a quoted cell')
  return rows.filter((r) => r.some((f) => f !== ''))
}

const unguard = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s)

export type CurationImport = {
  curation: Curation
  diagnostics: Diagnostic[]
  /** Records whose decision changed, and how. */
  changes: { record: Id; fields: string[] }[]
}

/**
 * Reads a sheet back over `base`. A blank cell clears that field; a record missing from the sheet keeps its decision.
 * Nothing is applied when there is any error: the caller gets the base unchanged, with every problem listed.
 */
export function curationFromCsv(text: string, base: Curation, options: { knownRecords?: Iterable<Id>; groups?: Iterable<Id> } = {}): CurationImport {
  const diagnostics: Diagnostic[] = []
  const error = (code: string, message: string, path?: string) => diagnostics.push({ severity: 'error', code, message, ...(path ? { path } : {}) })
  let rows: string[][]
  try {
    rows = parseCsv(text)
  } catch (e) {
    error('sheet-unreadable', (e as Error).message)
    return { curation: base, diagnostics, changes: [] }
  }
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  if (col('record') < 0) {
    error('no-record-column', 'The sheet has no "record" column')
    return { curation: base, diagnostics, changes: [] }
  }
  for (const h of header) if (!(CURATION_COLUMNS as readonly string[]).includes(h) && h) diagnostics.push({ severity: 'warning', code: 'unknown-column', message: `Column "${h}" isn't part of the curation and was ignored`, path: h })
  const known = options.knownRecords ? new Set(options.knownRecords) : null
  const groups = options.groups ? new Set(options.groups) : null
  const next: Record<string, RecordDecision> = JSON.parse(JSON.stringify(base.records)) as Record<string, RecordDecision>
  const seen = new Set<string>()
  const changes: CurationImport['changes'] = []
  rows.forEach((cells, n) => {
    const line = n + 2
    const id = (cells[col('record')] ?? '').trim()
    if (!id) return error('no-record', `Line ${line} has no record`, `line ${line}`)
    if (seen.has(id)) return error('duplicate-record', `${id} appears more than once (line ${line})`, id)
    seen.add(id)
    if (known && !known.has(id)) diagnostics.push({ severity: 'warning', code: 'unknown-record', message: `${id} isn't in this run; its decision is kept for when it is`, path: id })
    const d: RecordDecision = {}
    for (const c of EDITABLE) {
      const i = col(c)
      if (i < 0) {
        // A column left out keeps what was there.
        const was = base.records[id]?.[FIELD[c]]
        if (was !== undefined) (d as Record<string, unknown>)[FIELD[c]] = was
        continue
      }
      const v = unguard((cells[i] ?? '').trim())
      if (!v) continue
      if (c === 'provenance_class' && !PROVENANCE_CLASSES.includes(v as ProvenanceClass)) { error('unknown-provenance-class', `${id}: "${v}" isn't a provenance class (${PROVENANCE_CLASSES.join(', ')})`, id); continue }
      if (c === 'use' && !EVIDENCE_USES.includes(v as EvidenceUse)) { error('unknown-use', `${id}: "${v}" isn't a use (${EVIDENCE_USES.join(', ')})`, id); continue }
      if (c === 'group' && groups && !groups.has(v)) { error('unknown-group', `${id}: group "${v}" isn't one of this profile's groups`, id); continue }
      if (c === 'exclude') {
        if (!/^(yes|true|1|x)$/i.test(v) && !/^(no|false|0)$/i.test(v)) { error('bad-exclude', `${id}: exclude must be yes or no, not "${v}"`, id); continue }
        if (/^(yes|true|1|x)$/i.test(v)) d.exclude = true
        continue
      }
      ;(d as Record<string, unknown>)[FIELD[c]] = v
    }
    if (d.provenanceClass === 'origin-reported' && !d.originSource) error('origin-source-missing', `${id}: an origin-reported record needs an origin_source`, id)
    if (/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(`${d.site ?? ''} ${d.note ?? ''}`)) error('coordinates-in-sheet', `${id}: site and note must not hold coordinates; use an opaque site label`, id)
    const before = base.records[id] ?? {}
    const fields = [...new Set([...Object.keys(before), ...Object.keys(d)])].filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((d as Record<string, unknown>)[k]))
    if (fields.length) changes.push({ record: id, fields: fields.sort() })
    if (Object.keys(d).length) next[id] = d
    else delete next[id]
  })
  if (diagnostics.some((d) => d.severity === 'error')) return { curation: base, diagnostics, changes: [] }
  return { curation: { schemaVersion: 1, records: next }, diagnostics, changes }
}

/** Sets the same fields on many records at once, such as every record of one study. Other fields are kept. */
export function bulkAssign(curation: Curation, records: Iterable<Id>, patch: RecordDecision): Curation {
  const next = JSON.parse(JSON.stringify(curation.records)) as Record<string, RecordDecision>
  for (const id of records) next[id] = { ...next[id], ...patch }
  return { schemaVersion: 1, records: next }
}

/** Records of one study: the curation's `study` if set, otherwise the record's first publication title. */
export function recordsOfStudy(study: string, curation: Curation, records: SequenceRecord[]): Id[] {
  return records
    .filter((r) => (curation.records[r.version || r.accession]?.study ?? r.publications.find((p) => p.title)?.title) === study)
    .map((r) => r.version || r.accession)
}
