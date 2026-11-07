import { describe, expect, it } from 'vitest'
import { compareRuns, duplicateStudy, newStudy, omit, postHocOmissions, recordRun, studyLink, studyMethods, studyUse, withoutPostHoc, type ClaimReport, type Panel, type Study } from '../src/index.js'

const AT = '2026-11-06T00:00:00.000Z'
const evidence = (record: string, use = 'lineage-and-location') => ({ record, use, provenanceClass: 'wild-documented' })

function panel(version: string, groups: Record<string, string[]>, extra: Partial<Panel> = {}): Panel {
  return {
    schemaVersion: 2, id: 'p', version, checksum: `sha256:${version}`, status: 'candidate', taxa: [], marker: { kind: 'gene', gene: 'x' },
    reference: { accession: 'R1', length: 100 }, windows: [{ id: 'w', label: 'w', start: 0, end: 100 }],
    groups: Object.entries(groups).map(([id, records]) => ({ id, label: id, evidence: records.map((r) => evidence(r)) })), pairs: [], notCovered: [], validatedScope: [], claims: [], sources: [], builtBy: 'k',
    rules: { minSharedColumns: 100, minDepthPerColumn: 5, minBlocksForExclusion: 3, minDecisiveSites: 2, tolerance: 1 }, gates: {}, sequencesChecksum: `sha256:seq${version}`, ...extra,
  } as unknown as Panel
}

const claim = (passed: boolean, sites = 5, failed = 'sites'): ClaimReport => ({ a: 'n', b: 's', window: 'w', passed, sites: { a: sites, b: sites }, records: { a: 10, b: 10 }, gates: [{ gate: passed ? 'sites' : failed, passed, ran: true, detail: '' }] }) as ClaimReport

const withRecords = (): Study => {
  const s = newStudy('s', 'S', AT)
  const r = { organism: 'x', inTarget: true, hasMarker: true, papers: ['p1'], column: 'ingroup' as const }
  return { ...s, papers: [{ id: 'p1', label: 'P1', colorIndex: 0, title: 't', sources: ['pubmed'], linked: [], linkLookup: 'done' }], records: { A1: { ...r, accession: 'A1' }, A2: { ...r, accession: 'A2' }, A3: { ...r, accession: 'A3' } } }
}
const omitted = (s: Study, a: string, reason: string) => { const r = omit(s, a, { reason, at: AT }); expect(r.outcome).toBe('moved'); return r.study }
const run = { id: 'use-1', at: AT, stateHash: 'x' }

describe('compareRuns', () => {
  it('reports records that moved between groups, and those only on one side', () => {
    const c = compareRuns(panel('1', { n: ['A', 'B'], s: ['C'] }), panel('2', { n: ['A'], s: ['B', 'D'] }))
    expect(c.records).toMatchObject({ shared: 2, onlyA: ['C'], onlyB: ['D'], changedGroup: [{ record: 'B', a: 'n', b: 's' }] })
  })

  it('tells gained, lost, changed and same claims apart', () => {
    const p = panel('1', { n: ['A'] })
    const change = (x: ClaimReport, y: ClaimReport) => compareRuns(p, p, [x], [y]).claims[0]!.change
    expect(change(claim(false), claim(true))).toBe('gained')
    expect(change(claim(true), claim(false))).toBe('lost')
    expect(change(claim(true, 5), claim(true, 9))).toBe('changed')
    expect(change(claim(false, 5, 'interval'), claim(false, 5, 'sites'))).toBe('changed')
    expect(change(claim(true), claim(true))).toBe('same')
  })

  it("doesn't call a claim the same when only its evidence moved", () => {
    const p = panel('1', { n: ['A'] })
    const x = { ...claim(true), gates: [{ gate: 'across-studies', passed: true, ran: true, detail: '0 wrong across 3 studies' }] } as ClaimReport
    const y = { ...claim(true), gates: [{ gate: 'across-studies', passed: true, ran: true, detail: '0 wrong across 2 studies' }], interval: [0.8, 1] } as ClaimReport
    const c = compareRuns(p, p, [x], [y]).claims[0]!
    expect(c.change).toBe('changed')
    expect(c.gates).toEqual([{ gate: 'across-studies', before: '0 wrong across 3 studies', after: '0 wrong across 2 studies' }])
    expect(c.otherFields).toEqual(['interval'])
  })

  it('reports every evidence field, such as a relabeled study', () => {
    const a = panel('1', { n: ['A', 'B'] })
    const b = panel('2', { n: ['A', 'B'] })
    ;(b.groups[0]!.evidence[0] as { study?: string }).study = 'Merged label'
    expect(compareRuns(a, b).records.changedEvidence).toEqual([{ field: 'study', records: [{ record: 'A', a: null, b: 'Merged label' }] }])
  })

  it('reports a panel field it has no name for', () => {
    const a = panel('1', { n: ['A'] })
    const b = { ...panel('2', { n: ['A'] }), somethingNew: 1 } as unknown as Panel
    expect(compareRuns(a, b).settings).toContain('somethingNew')
    const relabeled = panel('2', { n: ['A'] })
    relabeled.groups[0]!.label = 'Renamed'
    expect(compareRuns(a, relabeled).settings).toContain('Groups')
  })

  it('never calls an unreported claim the same, and copes with panels from before claims existed', () => {
    const passed = { a: 'n', b: 's', window: 'w', minColumns: 100, sites: { a: 5, b: 5 }, basis: 'exploratory' }
    const listed = panel('1', { n: ['A'] }, { claims: [passed] } as Partial<Panel>)
    expect(compareRuns(listed, listed).claims[0]!.change).toBe('unknown')
    const old = panel('0', { n: ['A'] })
    delete (old as Partial<Panel>).claims
    expect(() => compareRuns(old, listed, { folds: [] } as unknown as ClaimReport[])).not.toThrow()
  })

  it("doesn't call a claim lost without both validation reports", () => {
    const passed = { a: 'n', b: 's', window: 'w', minColumns: 100, sites: { a: 5, b: 5 }, basis: 'exploratory' }
    const c = compareRuns(panel('1', { n: ['A'] }, { claims: [passed] } as Partial<Panel>), panel('2', { n: ['A'] }))
    expect(c.claims[0]!.change).toBe('unknown')
    expect(c.notes.join()).toMatch(/validation report is missing/)
  })

  it('names settings that differ, so a change is not blamed on the records', () => {
    const a = panel('1', { n: ['A'] })
    const b = panel('2', { n: ['A'] }, { rules: { ...a.rules, minDecisiveSites: 3 }, numtCopies: [{ id: 'l', aligned: 'A' }] })
    const c = compareRuns(a, b, [claim(true)], [{ ...claim(true), gates: [{ gate: 'nested-length', passed: true, ran: true, detail: '' }] } as ClaimReport])
    expect(c.settings).toEqual(expect.arrayContaining(['Evaluation rules', 'Nuclear copies', 'Validation gates']))
  })

  it('warns until a post hoc omission is compared with a version that has those records', () => {
    const study = { id: 's', title: 'S', stateHash: 'h', postHocOmitted: ['B'] }
    const left = panel('1', { n: ['A'] }, { study })
    expect(compareRuns(left, panel('2', { n: ['A'] })).notes.join()).toMatch(/Compare it with a version built without/)
    const both = compareRuns(left, panel('2', { n: ['A', 'B'] }))
    expect(both.postHoc).toEqual([{ side: 'a', omitted: ['B'], inOtherSide: ['B'] }])
    expect(both.notes.join()).not.toMatch(/Compare it with/)
  })
})

describe('duplicating a Study', () => {
  it('keeps seen runs, so later omissions in the copy are still post hoc', () => {
    const copy = duplicateStudy(recordRun(withRecords(), run), 'c', 'C', AT)
    expect(copy.runs).toEqual([{ ...run, inheritedFrom: 's' }])
    expect(omitted(copy, 'A1', 'looks odd').records.A1!.omitted!.timing).toBe('after-result')
  })

  it('leaves the original alone and records where the copy came from', () => {
    const original = recordRun(withRecords(), run)
    const before = JSON.stringify(original)
    const copy = duplicateStudy(original, 'c', 'C', AT)
    expect(JSON.stringify(original)).toBe(before)
    expect(copy.duplicatedFrom).toMatchObject({ id: 's', title: 'S' })
    expect(studyMethods(copy)).toMatch(/Duplicated from Study S/)
    expect(studyMethods(copy)).toMatch(/carried over from Study s/)
  })

  it('keeps the first origin when a copy is copied', () => {
    const twice = duplicateStudy(duplicateStudy(recordRun(withRecords(), run), 'c', 'C', AT), 'd', 'D', AT)
    expect(twice.runs[0]!.inheritedFrom).toBe('s')
  })
})

describe('without post hoc omissions', () => {
  it('restores only omissions made after a result', () => {
    const early = omitted(withRecords(), 'A1', 'too short')
    const late = omitted(recordRun(early, run), 'A2', 'hurts the result')
    expect(postHocOmissions(late)).toEqual(['A2'])
    const copy = withoutPostHoc(late, 'c', 'C', AT)
    expect(copy.records.A1!.omitted?.timing).toBe('before-result')
    expect(copy.records.A2!.omitted).toBeUndefined()
    expect(postHocOmissions(copy)).toEqual([])
    expect(studyUse(copy).include).toEqual(['A2', 'A3'])
    expect(copy.log.some((e) => e.action === 'restored' && e.item === 'A2')).toBe(true)
  })

  it('carries post hoc omissions on the link a panel seals', () => {
    const late = omitted(recordRun(withRecords(), run), 'A2', 'hurts the result')
    expect(studyLink(late).postHocOmitted).toEqual(['A2'])
    expect(studyUse(late).link.stateHash).toBe(studyLink(late).stateHash)
  })
})
