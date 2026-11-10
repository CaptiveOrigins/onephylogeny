import { renderToStaticMarkup } from 'react-dom/server'
import { standaloneSvg, TreeCanvas } from '../src/canvas'
import { Icon } from '../src/icons'
import { describe, expect, it } from 'vitest'
import { buildPanel, evaluateQuery, type Result } from '@captiveorigins/onephylogeny-core'
import { CoverageBars, ECOREGIONS_CREDIT, fitLayout, RegionMap, HaplotypeNetworkFigure, layoutNetwork, EventLog, LineageCard, OutgroupLadderView, parseNewickForDisplay, ResultView, StatusBadge, summarizeResult, TreeFigure, ValidationView } from '../src/index.js'

const ref = 'ACGT'.repeat(50)
const mut = (at: number[]) => [...ref].map((c, i) => (at.includes(i) ? (c === 'A' ? 'C' : 'A') : c)).join('')
const blank = (s: string, from: number, to: number) => [...s].map((c, i) => (i >= from && i < to ? c : '-')).join('')
const settings = { id: 'p', version: '1', groups: [{ id: 'a', label: 'Group A', region: 'North' }, { id: 'b', label: 'Group B' }, { id: 'c', label: 'Group C' }], notCovered: ['Far region'], validatedScope: [], rules: { minSharedColumns: 20, minDepthPerColumn: 1, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 } }
const { panel, sequences } = buildPanel({
  settings, taxa: [{ source: 't', id: '1' }], marker: { kind: 'gene', gene: 'g' }, reference: { accession: 'R.1', length: 200 }, sources: [], builtBy: 'r',
  members: [
    { record: 'a1', group: 'a', aligned: mut([5, 50, 90]), provenanceClass: 'wild-documented' },
    { record: 'b1', group: 'b', aligned: mut([6, 51, 91]), provenanceClass: 'wild-documented' },
    { record: 'c1', group: 'c', aligned: blank(mut([150, 160]), 120, 200), provenanceClass: 'wild-documented' },
  ],
})
const opts = { queryId: 'q', runId: 'r' }
const query = blank(mut([5, 50, 90]), 0, 110)
const result: Result = evaluateQuery(query, { panel, sequences }, opts)

describe('views', () => {
  it('states a clear conclusion and shows every group', () => {
    expect(summarizeResult(result, panel)).toBe('Consistent with Group A. Not evaluated: Group C.')
    const html = renderToStaticMarkup(<ResultView result={result} panel={panel} queryAligned={query} />)
    for (const text of ['Group A', 'Group B', 'Group C', 'Not evaluable', 'Far region', 'This sample']) expect(html).toContain(text)
  })
  it('never conveys a status by color alone', () => {
    expect(renderToStaticMarkup(<StatusBadge status="not_evaluable" />)).toContain('Not evaluable')
  })
  it('says so when nothing can be evaluated', () => {
    const none = evaluateQuery(blank(mut([]), 0, 5), { panel, sequences }, opts)
    expect(summarizeResult(none, panel)).toMatch(/Not enough comparable data/)
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

describe('haplotype network figure (roadmap stage 5)', () => {
  const network = { window: 'w', columns: 6, partial: 1, nodes: [{ id: 'h1', records: ['a1', 'a2', 'b1'], byGroup: { a: 2, b: 1 } }, { id: 'h2', records: ['a3'], byGroup: { a: 1 } }, { id: 'h3', records: ['b2'], byGroup: { b: 1 } }], edges: [{ a: 'h1', b: 'h2', steps: 1 }, { a: 'h2', b: 'h3', steps: 3 }] }
  it('draws the same way every time, inside the frame', () => {
    const one = layoutNetwork(network)
    expect([...layoutNetwork(network)]).toEqual([...one])
    for (const p of one.values()) { expect(p.x).toBeGreaterThanOrEqual(24); expect(p.x).toBeLessThanOrEqual(496) }
    // Fitted, every circle of radius up to the padding stays inside the frame.
    const fit = [...fitLayout(one, 520, 30).values()]
    for (const p of fit) for (const v of [p.x, p.y]) { expect(v).toBeGreaterThanOrEqual(30 - 1e-9); expect(v).toBeLessThanOrEqual(490 + 1e-9) }
  })
  it('names every group in a legend, labels multi-step links, and gives a table with the same numbers', () => {
    const html = renderToStaticMarkup(<HaplotypeNetworkFigure network={network} panel={panel} />)
    expect(html).toContain('Group A')
    expect(html).toContain('Group B')
    expect(html).not.toContain('Group C</li>')
    expect(html).toContain('3 haplotypes from 5 records, 2 links')
    expect(html).toMatch(/class="ophy-net-steps"[^>]*>3</)
    expect(html).toContain('1 partial records left out')
    expect(html).toContain('This is not a tree.')
    expect(html).toContain('<th scope="row">h2 to h3</th><td>3</td>')
  })
})

describe('region map (roadmap stage 5)', () => {
  const square = (id: number, name: string, x: number, y: number) => ({ type: 'Feature' as const, properties: { ECO_ID: id, ECO_NAME: name }, geometry: { type: 'Polygon' as const, coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]] as [number, number][]] } })
  const outlines = { type: 'FeatureCollection' as const, features: [square(1, 'North forests', 0, 2), square(2, 'South plains', 0, 0), square(3, 'Neighbour', 1, 0), square(9, 'Far away', 60, 60)] }
  const groups = [{ id: 'a', label: 'Group A', ecoregions: [1] }, { id: 'b', label: 'Group B', ecoregions: [2, 1] }, { id: 'c', label: 'Group C' }]
  it('shades tagged ecoregions by group, shows neighbours for context, and always credits the source', () => {
    const html = renderToStaticMarkup(<RegionMap panel={{ groups } as never} ecoregions={outlines} />)
    expect(html).toContain('Group A')
    expect(html).not.toContain('Group C</li>')
    expect(html).toContain('<title>North forests: Group A and Group B</title>')
    expect(html).toContain('ophy-map-shared')
    expect(html).toContain('<title>Neighbour</title>')
    expect(html).not.toContain('Far away')
    expect(html).toContain(ECOREGIONS_CREDIT)
    expect(html).toContain('<th scope="row">Group B</th><td>South plains; North forests</td>')
  })
  it('says so when no tag matches, and names tags missing from the outlines', () => {
    expect(renderToStaticMarkup(<RegionMap panel={{ groups: [{ id: 'a', label: 'A', ecoregions: [77] }] } as never} ecoregions={outlines} />)).toContain('no map to draw')
    expect(renderToStaticMarkup(<RegionMap panel={{ groups: [{ id: 'a', label: 'A', ecoregions: [1, 77] }] } as never} ecoregions={outlines} />)).toContain('Not in these outlines: 77.')
  })
})
