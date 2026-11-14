import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { comparePanels, type ClaimReport, type OutcomeRow, type Panel, type PerWindowReport } from '@extantape/onephylogeny-core'
import { ComparisonView } from '../src/index.js'

// Made-up panels and reports: just enough shape to compare, nothing real.
function panel(version: string, groups: Record<string, string[]>, extra: Partial<Panel> = {}): Panel {
  return {
    schemaVersion: 2, id: 'p', version, checksum: `sha256:${version}`, status: 'candidate', taxa: [], marker: { kind: 'gene', gene: 'x' },
    reference: { accession: 'R1', length: 100 }, windows: [{ id: 'w', label: 'Whole gene', start: 0, end: 100 }],
    groups: Object.entries(groups).map(([id, records]) => ({ id, label: `Group ${id.toUpperCase()}`, evidence: records.map((record) => ({ record, use: 'lineage-and-location', provenanceClass: 'wild-documented' })) })),
    pairs: [], notCovered: [], validatedScope: [], claims: [], sources: [], builtBy: 'k', rules: {}, gates: {}, sequencesChecksum: 'sha256:seq', ...extra,
  } as unknown as Panel
}
const claim = (b: string, passed: boolean, detail = ''): ClaimReport => ({ a: 'n', b, window: 'w', passed, sites: { a: 4, b: 3 }, records: { a: 8, b: 5 }, gates: [{ gate: 'sites', passed, ran: true, detail }] }) as ClaimReport
const row = (group: string, named: number, of: number): OutcomeRow => ({
  group, window: 'w', records: of, notTestable: 0, sites: of, outcomes: { tests: of, namedTruth: named, namedTruthAllCompared: named, truthKeptNotNamed: of - named, wrong: 0, unresolved: 0, notEvaluable: 0 },
  ...(of ? { namedTruth: { count: named, of, lower: 0.25, upper: 1 }, truthKept: { count: of, of, lower: 0.5, upper: 1 }, wrong: { count: 0, of, lower: 0, upper: 0.6 } } : {}),
})
const windows = (rows: OutcomeRow[]): PerWindowReport => ({ scheme: 'leave-one-site-out-by-window', interval: {} as PerWindowReport['interval'], windows: [{ window: 'w', label: 'Whole gene', separatingSites: 9, rows }], diagnostics: [] })

const a = panel('1', { n: ['A', 'B'], s: ['C'], t: ['E'] })
const b = panel('2', { n: ['A'], s: ['B', 'D'], t: ['E'] })
const comparison = comparePanels(a, b,
  { claims: [claim('s', false, '3 sites, 4 needed'), claim('t', true)], windows: windows([row('n', 3, 4), row('s', 0, 0)]) },
  { claims: [claim('s', true, '4 sites'), claim('t', true)], windows: windows([row('n', 2, 4), row('s', 0, 0)]) })
const html = renderToStaticMarkup(<ComparisonView comparison={comparison} />)

describe('ComparisonView', () => {
  it('says what moved, with group labels, in tables with captions and header cells', () => {
    expect(html).toContain('3 records in both, 1 only in A, 1 only in B. 1 of the shared records changed group.')
    expect(html).toContain('<caption>Records that changed group</caption>')
    expect(html).toContain('<th scope="row">B</th><td>Group N</td><td>Group S</td>')
    expect(html).toContain('Only in A: C.')
    expect(html).toContain("It doesn&#x27;t say which is better")
    // Every table has a caption, and every column a header cell.
    expect(html.match(/<table/g)!.length).toBe(html.match(/<caption>/g)!.length)
    expect(html).not.toMatch(/<th>/)
  })

  it('lists changed claims with both sides and the gate that moved, and hides unchanged ones until asked', () => {
    expect(html).toContain('2 claims, each one pair of groups in one window. 1 of them is the same in both versions.')
    expect(html).toContain('<th scope="row">Group N vs Group S, Whole gene</th><td>Now passes</td><td>Failed at the sites gate.')
    expect(html).toContain('sites gate. A: 3 sites, 4 needed. B: 4 sites.')
    expect(html).not.toContain('Group N vs Group T')
    expect(html).toContain('Show unchanged claims')
    const all = renderToStaticMarkup(<ComparisonView comparison={comparison} initiallyShowSame />)
    expect(all).toContain('<th scope="row">Group N vs Group T, Whole gene</th><td>Same</td>')
  })

  it('shows each version\'s outcomes with intervals, row by row, never as a rate or a score', () => {
    expect(html).toContain('<caption>Whole gene, holding out each site. Differs for Group N.</caption>')
    expect(html).toContain('<th scope="row">Group N, version 1</th><td>4</td><td>0</td><td>4</td><td>3 of 4 (25% to 100%)</td>')
    expect(html).toContain('<th scope="row">Group N, version 2</th><td>4</td><td>0</td><td>4</td><td>2 of 4 (25% to 100%)</td>')
    expect(html).toContain('<th scope="row">Group S, version 1</th><td>0</td><td>0</td><td>0</td><td>No tests</td>')
    expect(html.replace(/\(\d+% to \d+%\)/g, '').replace('95% interval', '')).not.toMatch(/\d%/)
    expect(html).toContain('there is no overall score')
  })

  it('puts missing reports and post hoc notes first, and says when there are no outcomes', () => {
    const left = panel('1', { n: ['A', 'B'] }, { study: { id: 's', title: 'S', stateHash: 'h', postHocOmitted: ['B'] } } as Partial<Panel>)
    const bare = renderToStaticMarkup(<ComparisonView comparison={comparePanels(left, panel('2', { n: ['A'] }))} />)
    expect(bare).toContain('role="note">A validation report is missing')
    expect(bare).toContain('From Study &quot;S&quot;, with 1 record left out after results were seen.')
    expect(bare).toContain('role="note">Version 1 left out 1 record after results were seen: B. The other version has 0 of them.')
    // The omission comes before the missing report, and both before the records.
    expect(bare.indexOf('left out 1 record after')).toBeLessThan(bare.indexOf('A validation report is missing'))
    expect(bare).toContain('Neither version has outcomes by window.')
    expect(bare).not.toContain('Show unchanged claims')
  })
})
