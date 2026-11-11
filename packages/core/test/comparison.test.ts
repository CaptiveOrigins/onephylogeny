import { describe, expect, it } from 'vitest'
import { comparePanels, compareOutcomes, comparisonMarkdown, compareRuns, countText, type ClaimReport, type OutcomeRow, type Panel, type PerWindowReport, type StudyOutReport } from '../src/index.js'

// Made-up panels and reports: just enough shape to compare, nothing real.
const evidence = (record: string, study?: string) => ({ record, use: 'lineage-and-location', provenanceClass: 'wild-documented', ...(study ? { study } : {}) })
function panel(version: string, groups: Record<string, string[]>, extra: Partial<Panel> = {}): Panel {
  return {
    schemaVersion: 2, id: 'p', version, checksum: `sha256:${version}`, status: 'candidate', taxa: [], marker: { kind: 'gene', gene: 'x' },
    reference: { accession: 'R1', length: 100 }, windows: [{ id: 'w', label: 'Whole gene', start: 0, end: 100 }],
    groups: Object.entries(groups).map(([id, records]) => ({ id, label: `Group ${id.toUpperCase()}`, evidence: records.map((r) => evidence(r)) })), pairs: [], notCovered: [], validatedScope: [], claims: [], sources: [], builtBy: 'k',
    rules: { minSharedColumns: 100, minDepthPerColumn: 5, minBlocksForExclusion: 3, minDecisiveSites: 2, tolerance: 1 }, gates: {}, sequencesChecksum: `sha256:seq${version}`, ...extra,
  } as unknown as Panel
}
const claim = (passed: boolean, detail = ''): ClaimReport => ({ a: 'n', b: 's', window: 'w', passed, sites: { a: 4, b: passed ? 4 : 2 }, records: { a: 10, b: 6 }, gates: [{ gate: 'sites', passed, ran: true, detail }] }) as ClaimReport
const interval = (count: number, of: number, lower: number, upper: number) => ({ count, of, lower, upper })
const row = (group: string, named: number, of: number, window = 'w'): OutcomeRow => ({
  group, window, records: of, notTestable: 0, sites: of, outcomes: { tests: of, namedTruth: named, namedTruthAllCompared: named, truthKeptNotNamed: of - named, wrong: 0, unresolved: 0, notEvaluable: 0 },
  truthKept: interval(of, of, 0.5, 1), namedTruth: interval(named, of, named / of / 2, 1), wrong: interval(0, of, 0, 0.4),
})
const windows = (rows: OutcomeRow[]): PerWindowReport => ({ scheme: 'leave-one-site-out-by-window', interval: 'clopper-pearson-95' as never, windows: [{ window: 'w', label: 'Whole gene', separatingSites: 12, rows }], diagnostics: [] })
const studyOut = (rows: OutcomeRow[]): StudyOutReport => ({ scheme: 'leave-one-study-out-by-window', interval: 'clopper-pearson-95' as never, studies: ['s1', 's2'], rows: [], totals: rows, recordsWithoutStudy: 0, diagnostics: [] })

describe('compareOutcomes', () => {
  it('pairs each version\'s rows by scheme, window and group, and marks only identical rows as the same', () => {
    const o = compareOutcomes({ windows: windows([row('n', 3, 4), row('s', 2, 4)]), studyOut: studyOut([row('n', 1, 2)]) }, { windows: windows([row('n', 3, 4), row('s', 1, 4)]), studyOut: studyOut([row('n', 1, 2)]) })
    expect(o.missing).toEqual([])
    expect(o.pairs.map((p) => [p.scheme, p.group, p.same])).toEqual([['site', 'n', true], ['site', 's', false], ['study', 'n', true]])
    expect(o.pairs[1]!.a!.namedTruth!.count).toBe(2)
    expect(o.pairs[1]!.b!.namedTruth!.count).toBe(1)
  })

  it('keeps a group found in one version only, never dropping it, and never subtracts', () => {
    const o = compareOutcomes({ windows: windows([row('n', 3, 4)]) }, { windows: windows([row('n', 3, 4), row('e', 1, 3)]) })
    const added = o.pairs.find((p) => p.group === 'e')!
    expect(added).toMatchObject({ a: null, same: false })
    expect(added.b!.records).toBe(3)
    // Pairs carry each side's own numbers and nothing derived from both.
    expect(Object.keys(added).sort()).toEqual(['a', 'b', 'group', 'same', 'scheme', 'window'])
  })

  it('says which version has no outcomes, as reports made before them do, and pairs nothing when neither has them', () => {
    const o = compareOutcomes({ claims: [] }, { windows: windows([row('n', 3, 4)]) })
    expect(o.missing).toEqual([{ side: 'a', scheme: 'site' }])
    expect(o.pairs).toHaveLength(1)
    expect(compareOutcomes(undefined, undefined)).toEqual({ pairs: [], missing: [] })
  })
})

describe('comparePanels', () => {
  it('leaves compareRuns\' result exactly as it is, and adds labels from both panels', () => {
    const a = panel('1', { n: ['A', 'B'], s: ['C'] })
    const b = panel('2', { n: ['A'], s: ['B'], e: ['D'] })
    const c = comparePanels(a, b, { claims: [claim(false)] }, { claims: [claim(true)] })
    expect(c.runs).toEqual(compareRuns(a, b, [claim(false)], [claim(true)]))
    expect(c.labels.groups).toEqual({ n: 'Group N', s: 'Group S', e: 'Group E' })
    expect(c.labels.windows).toEqual({ w: 'Whole gene' })
  })
})

describe('comparisonMarkdown', () => {
  const a = panel('1', { n: ['A', 'B'], s: ['C'] })
  const b = panel('2', { n: ['A'], s: ['B', 'D'] }, { rules: { minSharedColumns: 120, minDepthPerColumn: 5, minBlocksForExclusion: 3, minDecisiveSites: 2, tolerance: 1 } } as Partial<Panel>)
  const md = comparisonMarkdown(comparePanels(a, b, { claims: [claim(false, '2 sites, 4 needed')], windows: windows([row('n', 3, 4)]) }, { claims: [claim(true, '4 sites')], windows: windows([row('n', 2, 4)]) }))

  it('says what moved between versions, in plain words with labels', () => {
    expect(md).toContain('# p 1 compared with p 2')
    expect(md).toContain('It doesn\'t say which is better')
    expect(md).toContain('2 records in both, 1 only in A, 1 only in B. 1 of the shared records changed group.')
    expect(md).toContain('Only in A: C.')
    expect(md).toContain('| B | Group N | Group S |')
    expect(md).toContain('These differ, so changes may not come from the records alone: Evaluation rules.')
    expect(md).toContain('The aligned sequences differ.')
  })

  it('lists a claim that changed with both sides and the gate that moved', () => {
    expect(md).toContain('1 claim, each one pair of groups in one window. 0 of them are the same in both versions.')
    expect(md).toContain('| Group N vs Group S, Whole gene | Now passes | Failed at the sites gate. Group N: 4 sites, 10 records. Group S: 2 sites, 6 records. | Passed. Group N: 4 sites, 10 records. Group S: 4 sites, 6 records. |')
    expect(md).toContain('- Group N vs Group S, Whole gene: sites gate. A: 2 sites, 4 needed. B: 4 sites.')
    // Fields both sides' text already shows aren't listed again; anything else that moved is.
    expect(md).not.toContain('also differs')
    const more = comparisonMarkdown(comparePanels(a, a, { claims: [claim(true)] }, { claims: [{ ...claim(true), interval: [0.5, 1] } as ClaimReport] }))
    expect(more).toContain('| Group N vs Group S, Whole gene | Same outcome, different report |')
    expect(more).toContain('- Group N vs Group S, Whole gene: also differs in interval.')
  })

  it('shows each version\'s outcome counts with their intervals, never a bare rate or a score', () => {
    expect(md).toContain('### Whole gene, holding out each site')
    expect(md).toContain('Differs for Group N.')
    expect(md).toContain(`| Group N | 1 | 4 | 0 | 4 | ${countText(interval(3, 4, 0.375, 1))} |`)
    expect(md).toContain('| Group N | 2 | 4 | 0 | 4 | 2 of 4 (25% to 100%) |')
    expect(md.replace(/\(\d+% to \d+%\)/g, '').replace('95% interval', '')).not.toMatch(/\d%/)
    expect(md).not.toMatch(/score:|probability of/i)
  })

  it('warns first when a report is missing, and says when nothing changed', () => {
    const same = comparisonMarkdown(comparePanels(a, a))
    expect(same).toMatch(/## Read this first\n\n- A validation report is missing/)
    expect(same).toContain('Settings are the same. The aligned sequences are identical.')
    expect(same).toContain('Neither version has outcomes by window.')
    const partial = comparisonMarkdown(comparePanels(a, b, { claims: [claim(true)] }, { claims: [claim(true)], windows: windows([row('n', 2, 4)]) }))
    expect(partial).toContain('Version 1 has no outcomes holding out each site')
    expect(partial).toContain('| Group N | 1 | Not in this version |')
    const left = panel('1', { n: ['A', 'B'] }, { study: { id: 's', title: 'S', stateHash: 'h', postHocOmitted: ['B', 'Z'] } } as Partial<Panel>)
    expect(comparisonMarkdown(comparePanels(left, panel('2', { n: ['A', 'B'] })))).toMatch(/## Read this first\n\n- Version 1 left out 2 records after results were seen: B, Z\. The other version has 1 of them\.\n- A validation report is missing/)
  })

  it('escapes table cells so a record name can\'t break the table', () => {
    const odd = comparisonMarkdown(comparePanels(panel('1', { n: ['X|1'] }), panel('2', { s: ['X|1'] })))
    expect(odd).toContain('| X\\|1 | Group N | Group S |')
  })
})
