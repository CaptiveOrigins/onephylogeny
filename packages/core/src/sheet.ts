import type { SequenceRecord } from './model.js'

const COLUMNS: { name: string; get: (r: SequenceRecord) => string | number | undefined }[] = [
  { name: 'accession', get: (r) => r.version || r.accession },
  { name: 'organism', get: (r) => r.organism },
  { name: 'taxon', get: (r) => r.taxon && `${r.taxon.source}:${r.taxon.id}` },
  { name: 'isolate', get: (r) => r.isolate },
  { name: 'voucher', get: (r) => r.voucher },
  { name: 'geo_loc_name', get: (r) => r.geoLocName },
  { name: 'collection_date', get: (r) => r.collectionDate },
  { name: 'publication', get: (r) => r.publications.map((p) => p.title).filter(Boolean).join(' | ') },
  { name: 'provenance_class', get: (r) => r.provenanceClass },
  { name: 'definition', get: (r) => r.definition },
  { name: 'length', get: (r) => r.sequenceLength },
  { name: 'sequence_sha256', get: (r) => r.sequenceSha256 },
]

function cell(v: string | number | undefined): string {
  if (v === undefined) return ''
  let s = String(v)
  // Source text must not run as a formula when the sheet is opened in a spreadsheet.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The record sheet as CSV. Coordinates are left out unless a caller explicitly asks for them. */
export function toRecordSheet(records: SequenceRecord[], options: { includeCoordinates?: boolean } = {}): string {
  const columns = options.includeCoordinates ? [...COLUMNS, { name: 'lat_lon', get: (r: SequenceRecord) => r.latLon }] : COLUMNS
  const rows = [columns.map((c) => c.name).join(',')]
  for (const r of records) rows.push(columns.map((c) => cell(c.get(r))).join(','))
  return `${rows.join('\n')}\n`
}
