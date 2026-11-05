import { renderToStaticMarkup } from 'react-dom/server'
import { standaloneSvg, TreeCanvas } from '../src/canvas'
import { Icon } from '../src/icons'
import { describe, expect, it } from 'vitest'
import { buildPanel, evaluateQuery, type Result } from '@captiveorigins/onephylogeny-core'
import { CoverageBars, EventLog, LineageCard, OutgroupLadderView, parseNewickForDisplay, ResultView, StatusBadge, summarizeResult, TreeFigure, ValidationView } from '../src/index.js'

const ref = 'ACGT'.repeat(50)
const mut = (at: number[]) => [...ref].map((c, i) => (at.includes(i) ? (c === 'A' ? 'C' : 'A') : c)).join('')
const blank = (s: string, from: number, to: number) => [...s].map((c, i) => (i >= from && i < to ? c : '-')).join('')
const settings = { id: 'p', version: '1', groups: [{ id: 'a', label: 'Group A', region: 'North' }, { id: 'b', label: 'Group B' }, { id: 'c', label: 'Group C' }], notCovered: ['Far region'], validatedScope: [], thresholds: { minOverlap: 20, tolerance: 1, minDiagnosticConflicts: 2 } }
const { panel, sequences } = buildPanel({
  settings, taxa: [{ source: 't', id: '1' }], marker: { kind: 'gene', gene: 'g' }, reference: { accession: 'R.1', length: 200 }, sources: [], builtBy: 'r',
  members: [
    { record: 'a1', group: 'a', aligned: mut([5, 50, 90]), provenanceClass: 'wild-documented' },
    { record: 'b1', group: 'b', aligned: mut([6, 51, 91]), provenanceClass: 'seized' },
    { record: 'c1', group: 'c', aligned: blank(mut([150, 160]), 120, 200), provenanceClass: 'wild-documented' },
  ],
})
const opts = { queryId: 'q', runId: 'r' }
const query = blank(mut([5, 50, 90]), 0, 110)
const result: Result = evaluateQuery(query, { panel, sequences }, opts)

describe('views', () => {
  it('states a clear conclusion and shows every group', () => {
    expect(summarizeResult(result, panel)).toBe('Consistent with Group A')
    const html = renderToStaticMarkup(<ResultView result={result} panel={panel} queryAligned={query} />)
    for (const text of ['Group A', 'Group B', 'Group C', 'Not evaluable', 'Far region', 'This sample']) expect(html).toContain(text)
  })
  it('never conveys a status by color alone', () => {
    expect(renderToStaticMarkup(<StatusBadge status="not_evaluable" />)).toContain('Not evaluable')
  })
  it('says so when nothing can be evaluated', () => {
    const none = evaluateQuery(blank(mut([]), 0, 5), { panel, sequences }, opts)
    expect(summarizeResult(none, panel)).toMatch(/Not enough shared sequence/)
  })
  it('keeps the record-page card short, and links to the detail', () => {
    const html = renderToStaticMarkup(<LineageCard result={result} panel={panel} marker="gene g" href="/detail" />)
    expect(html).toContain('Not evidence of where this animal was collected')
    expect(html).toContain('/detail')
    expect(html).not.toContain('<table')
  })
  it('draws coverage for every group', () => {
    expect(renderToStaticMarkup(<CoverageBars panel={panel} />).match(/ophy-coverage-group/g)).toHaveLength(3)
  })
  it('reads a tree and marks only support that passes every threshold', () => {
    const newick = '((a:0.1,b:0.2)95.1/96:0.1,(c:0.1,d:0.1)80/70:0.2,e:0.3);'
    expect(parseNewickForDisplay(newick).children).toHaveLength(3)
    const html = renderToStaticMarkup(<TreeFigure newick={newick} thresholds={[80, 95]} labelFor={(t) => `tip ${t}`} />)
    expect(html).toContain('tip a')
    expect(html.match(/ophy-tree-supported/g)).toHaveLength(1)
  })
  it('renders logs, ladders and validation gaps', () => {
    expect(renderToStaticMarkup(<EventLog events={[{ at: '2026-01-01T00:00:00.000Z', level: 'error', step: 'x', message: 'bad' }]} />)).toContain('ophy-log-error')
    expect(renderToStaticMarkup(<OutgroupLadderView steps={[{ taxon: { name: 'Genus', rank: 'genus' }, records: 1, species: ['s'], sufficient: false }]} caveat="Check it" />)).toContain('looking further out')
    const base = { scheme: 'leave-one-block-out' as const, tested: 1, skipped: 1, diagnostics: [], untestedGroups: ['b'] }
    const score = (group: string) => ({ group, tested: 1, includedTruth: 1, onlyTruth: 1, excludedTruth: 0, inconclusive: 0, flagged: 0, notEvaluable: 0, meanConsistent: 1 })
    const html = renderToStaticMarkup(<ValidationView blocks={{ ...base, groups: [score('a')] }} groups={{ ...base, scheme: 'leave-one-group-out', groups: [score('a'), score('b')], falseConsistent: 0 }} />)
    expect(html).toContain('all their records come from one site: b')
    expect(html).toContain('calibrated')
  })

  it('draws a tree on a canvas with every control named', () => {
    const html = renderToStaticMarkup(<TreeCanvas newick="((a:1,b:1)95/96:1,c:1);" thresholds={[80, 95]} />)
    for (const label of ['Zoom in', 'Zoom out', 'Fit', 'Download SVG', 'Print']) {
      expect(html).toContain(`aria-label="${label}"`)
      expect(html).toContain(`data-tip="${label}"`)
    }
    expect(html).toContain('ophy-tree-supported')
    expect(html).toContain('>a<')
  })
  it('saves a tree that opens on its own', () => {
    const svg = standaloneSvg('<svg class="ophy-tree" style="transform:scale(2)" viewBox="0 0 1 1"><path class="ophy-tree-edge"></path></svg>')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toContain('transform')
    expect(svg).toMatch(/<svg[^>]*><style>\.ophy-tree-edge\{fill:none/)
  })
  it('hides icons from screen readers so words do the naming', () => {
    expect(renderToStaticMarkup(<Icon name="fit" />)).toContain('aria-hidden="true"')
  })
})
