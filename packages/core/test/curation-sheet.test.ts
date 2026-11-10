import { describe, expect, it } from 'vitest'
import { bulkAssign, curationFromCsv, curationToCsv, parseCsv, recordsOfStudy, type Curation, type SequenceRecord } from '../src/index.js'

// Invented records: only the fields the sheet reads.
const rec = (id: string, title?: string): SequenceRecord => ({ version: id, accession: id.split('.')[0], organism: 'Example taxon', sequenceLength: 1140, definition: `${id} gene x`, publications: title ? [{ title }] : [], latLon: '1.234 N 5.678 W' }) as unknown as SequenceRecord
const records = [rec('A1.1', 'Study one'), rec('A2.1', 'Study one'), rec('B1.1', 'Study two'), rec('C1.1')]
const base: Curation = { schemaVersion: 1, records: { 'A1.1': { group: 'a', provenanceClass: 'wild-documented', site: 's1' }, 'B1.1': { group: 'b', provenanceClass: 'origin-reported', originSource: 'Table 2', note: '=SUM(1,2)' } } }

describe('curation sheet (roadmap stage 3)', () => {
  it('writes every record, decided or not, with context and no coordinates', () => {
    const csv = curationToCsv(base, records)
    const [header, ...rows] = parseCsv(csv)
    expect(header).toEqual(['record', 'group', 'provenance_class', 'use', 'site', 'study', 'origin_source', 'exclude', 'note', 'organism', 'length', 'title'])
    expect(rows.map((r) => r[0])).toEqual(['A1.1', 'A2.1', 'B1.1', 'C1.1'])
    expect(rows[0]!.slice(1, 3)).toEqual(['a', 'wild-documented'])
    expect(rows[3]!.at(-1)).toBe('C1.1 gene x')
    expect(csv).not.toContain('5.678')
    // A formula is defused on the way out and restored on the way in.
    expect(rows[2]![8]).toBe("'=SUM(1,2)")
  })

  it('round-trips unchanged', () => {
    const r = curationFromCsv(curationToCsv(base, records), base, { knownRecords: records.map((x) => x.version), groups: ['a', 'b'] })
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(r.changes).toEqual([])
    expect(r.curation).toEqual(base)
  })

  it('reads edits back and counts them; a blank cell clears, a missing row keeps', () => {
    const sheet = 'record,group,provenance_class,site,note\r\nA1.1,b,wild-documented,s1,\r\nA2.1,a,museum-documented,s9,"says ""maybe"", see notes"\r\n'
    const r = curationFromCsv(sheet, base, { groups: ['a', 'b'] })
    expect(r.diagnostics).toEqual([])
    expect(r.curation.records['A1.1']).toEqual({ group: 'b', provenanceClass: 'wild-documented', site: 's1' })
    expect(r.curation.records['A2.1']).toEqual({ group: 'a', provenanceClass: 'museum-documented', site: 's9', note: 'says "maybe", see notes' })
    expect(r.curation.records['B1.1']).toEqual(base.records['B1.1'])
    expect(r.changes).toEqual([{ record: 'A1.1', fields: ['group'] }, { record: 'A2.1', fields: ['group', 'note', 'provenanceClass', 'site'] }])
  })

  it('keeps fields whose column was left out of the sheet', () => {
    const r = curationFromCsv('record,note\nB1.1,checked\n', base)
    expect(r.curation.records['B1.1']).toEqual({ ...base.records['B1.1'], note: 'checked' })
  })

  it('refuses the whole sheet on any error, listing each one', () => {
    const sheet = ['record,group,provenance_class,use,exclude,origin_source,site', 'A1.1,z,wild,both,maybe,,', 'A1.1,a,,,,,', 'B1.1,b,origin-reported,,,,', ',a,,,,,', 'C1.1,a,,,,,"-3.4653, -62.2159"'].join('\n')
    const r = curationFromCsv(sheet, base, { groups: ['a', 'b'] })
    expect(r.curation).toBe(base)
    expect(r.changes).toEqual([])
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual(['bad-exclude', 'coordinates-in-sheet', 'duplicate-record', 'no-record', 'origin-source-missing', 'unknown-group', 'unknown-provenance-class', 'unknown-use'])
  })

  it('warns about unknown columns and records, and refuses a sheet without a record column or with a broken quote', () => {
    const r = curationFromCsv('record,colour,group\nZ9.1,red,a\n', base, { knownRecords: ['A1.1'] })
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([['warning', 'unknown-column'], ['warning', 'unknown-record']])
    expect(r.curation.records['Z9.1']).toEqual({ group: 'a' })
    expect(curationFromCsv('group\na\n', base).diagnostics[0]!.code).toBe('no-record-column')
    expect(curationFromCsv('record,note\nA1.1,"open\n', base).diagnostics[0]!.code).toBe('sheet-unreadable')
  })

  it('accepts yes/no for exclude, and a sheet saved with a byte-order mark', () => {
    const r = curationFromCsv('﻿record,exclude\nA1.1,yes\nB1.1,no\n', base)
    expect(r.curation.records['A1.1']!.exclude).toBe(true)
    expect(r.curation.records['B1.1']!.exclude).toBeUndefined()
  })

  it('assigns a whole study at once, keeping other fields', () => {
    const ids = recordsOfStudy('Study one', base, records)
    expect(ids).toEqual(['A1.1', 'A2.1'])
    const next = bulkAssign(base, ids, { provenanceClass: 'museum-documented', study: 'Study one' })
    expect(next.records['A1.1']).toEqual({ group: 'a', provenanceClass: 'museum-documented', site: 's1', study: 'Study one' })
    expect(next.records['A2.1']).toEqual({ provenanceClass: 'museum-documented', study: 'Study one' })
    expect(base.records['A1.1']!.provenanceClass).toBe('wild-documented')
  })
})
