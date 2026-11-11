import { describe, expect, it } from 'vitest'
import { geneSummary, reportMarkdown, resultConflicts, sampleReport, type Finding, type FindingWindow, type Panel, type PanelWindow, type Result } from '../src/index.js'

// Made-up gene windows (ADR 0009, decision 5): ATP8 and ATP6 overlap by 10 columns, as they do in real mitogenomes,
// and ND6 is never reached by the query.
const gene = (id: string, label: string, start: number, end: number, kind: 'cds' | 'rrna' | 'trna' = 'cds', strand: '+' | '-' = '+'): PanelWindow => ({ id, label, start, end, gene: { kind, strand } })
const windows: PanelWindow[] = [gene('cox1', 'COX1', 0, 100), gene('atp8', 'ATP8', 100, 160), gene('atp6', 'ATP6', 150, 250), gene('nd6', 'ND6', 250, 350, 'cds', '-')]
const fw = (window: string, sharedColumns: number, differences: number, allowedDifferences: number): FindingWindow => ({ window, sharedColumns, differences, unresolved: 0, allowedDifferences, nearest: [] })
const finding = (group: string, status: Finding['status'], ws: FindingWindow[]): Finding => ({ group, status, reasonCode: 'within-spread', reason: 'x', overlap: ws.reduce((n, w) => n + w.sharedColumns, 0), informativeSites: 0, windows: ws, evidence: [] })
// North is nearest in COX1, South in ATP8, and they tie in ATP6.
const findings: Finding[] = [
  finding('n', 'inconclusive', [fw('cox1', 100, 0, 2), fw('atp8', 60, 3, 1), fw('atp6', 100, 1, 2)]),
  finding('s', 'inconclusive', [fw('cox1', 100, 5, 2), fw('atp8', 60, 0, 1), fw('atp6', 100, 1, 2)]),
  finding('e', 'not_evaluable', []),
]
// Bases over the first 250 columns, one of them an N; nothing over ND6.
const query = `ACGTA${'N'}${'ACGT'.repeat(61)}${'-'.repeat(100)}`

describe('summary across gene windows (ADR 0009, decision 5)', () => {
  const s = geneSummary(query, windows, findings)!

  it('counts the genes compared, and each column once where genes overlap', () => {
    expect(query).toHaveLength(350)
    expect(s.geneWindows).toBe(4)
    expect(s.comparedWindows).toBe(3)
    // COX1 100 + ATP8 60 + ATP6 100, less the 10 columns ATP8 and ATP6 share.
    expect(s.columns).toBe(250)
    expect(s.queryColumns).toBe(249)
  })

  it('lists, per gene, the groups compared, within their spread and nearest, in reference order', () => {
    expect(s.windows).toEqual([
      { window: 'cox1', label: 'COX1', compared: ['n', 's'], withinSpread: ['n'], nearest: ['n'], sharedColumns: 100 },
      { window: 'atp8', label: 'ATP8', compared: ['n', 's'], withinSpread: ['s'], nearest: ['s'], sharedColumns: 60 },
      { window: 'atp6', label: 'ATP6', compared: ['n', 's'], withinSpread: ['n', 's'], nearest: ['n', 's'], sharedColumns: 100 },
    ])
  })

  it('counts the genes supporting each group as nearest, a tie for each, and names the genes that disagree', () => {
    expect(s.nearest).toEqual([{ group: 'n', windows: ['cox1', 'atp6'] }, { group: 's', windows: ['atp8', 'atp6'] }])
    // ATP6 ties, so it shares a nearest group with both and disagrees with neither.
    expect(s.disagreeing).toEqual(['cox1', 'atp8'])
    // The same nearest groups conflicts report, per window.
    const conflict = resultConflicts({ findings, pairs: [] } as unknown as Result).find((c) => c.kind === 'windows-disagree')
    expect(conflict).toEqual({ kind: 'windows-disagree', windows: [{ window: 'atp6', closest: ['n', 's'] }, { window: 'atp8', closest: ['s'] }, { window: 'cox1', closest: ['n'] }] })
  })

  it('genes that agree have no disagreement', () => {
    const agree = geneSummary(query, windows, [finding('n', 'consistent', [fw('cox1', 100, 0, 2), fw('atp6', 100, 0, 2)]), finding('s', 'excluded_within_panel', [fw('cox1', 100, 4, 2), fw('atp6', 100, 3, 2)])])!
    expect(agree.disagreeing).toEqual([])
    expect(agree.nearest).toEqual([{ group: 'n', windows: ['cox1', 'atp6'] }])
  })

  it('carries no probability, score or total of any kind', () => {
    expect(JSON.stringify(s)).not.toMatch(/probab|score|likel|weight|total|combined/i)
    expect(Object.keys(s).sort()).toEqual(['columns', 'comparedWindows', 'disagreeing', 'geneWindows', 'nearest', 'queryColumns', 'windows'])
  })

  it('is absent for a panel without gene windows, such as cytb, and ignores windows that aren\'t genes', () => {
    const cytb: PanelWindow[] = [{ id: 'w1', label: 'Fragment 1', start: 0, end: 200 }, { id: 'w2', label: 'Fragment 2', start: 150, end: 350 }]
    expect(geneSummary(query, cytb, findings)).toBeUndefined()
    const mixed = geneSummary(query, [...windows, { id: 'extra', label: 'Extra', start: 0, end: 50 }], [...findings.slice(0, 1).map((f) => ({ ...f, windows: [...f.windows, fw('extra', 50, 9, 0)] })), findings[1]!])!
    expect(mixed.geneWindows).toBe(4)
    expect(mixed.windows.map((w) => w.window)).toEqual(['cox1', 'atp8', 'atp6'])
  })

  it('says so when no gene could be compared', () => {
    const none = geneSummary(query, windows, [finding('n', 'not_evaluable', [])])!
    expect(none).toMatchObject({ geneWindows: 4, comparedWindows: 0, columns: 0, queryColumns: 0, windows: [], nearest: [], disagreeing: [] })
  })
})

describe('the report\'s "Across genes" section', () => {
  const panel = { id: 'mito', version: '1', checksum: 'sha256:x', status: 'candidate', claims: [], groups: [{ id: 'n', label: 'North', coverage: [], evidence: [] }, { id: 's', label: 'South', coverage: [], evidence: [] }, { id: 'e', label: 'East', coverage: [], evidence: [] }], notCovered: [], sources: [], windows } as unknown as Panel
  const base = {
    schemaVersion: 2, query: 'q', run: 'r', overlap: 249, candidatesNotEvaluated: ['e'], caveats: [], pairs: [], findings,
    panel: { id: 'mito', version: '1', checksum: 'sha256:x' }, novelty: { flagged: false, reasons: [], neitherSideSites: 0 }, outOfValidatedScope: [],
  } as unknown as Result

  it('describes the genes in plain words, with group and gene names, and says it is no probability', () => {
    const r = sampleReport(panel, { ...base, geneSummary: geneSummary(query, windows, findings)! })
    expect(r.genes!.summary).toEqual([
      'Compared in 3 of 4 genes, over 250 reference columns (a column in two overlapping genes counted once). This sequence has a base at 249 of them.',
      'Nearest group in each gene, by differences per shared column: North in 2 genes (COX1, ATP6); South in 2 genes (ATP8, ATP6). A gene where groups tie counts for each of them.',
      'These genes point to different nearest groups: COX1, ATP8.',
      'These are counts of genes, not a probability or a score. The genes of one mitogenome are inherited together, so genes that agree are not independent tests.',
    ])
    expect(r.genes!.windows[0]).toEqual({ gene: 'COX1', columns: 100, withinSpread: ['North'], nearest: ['North'] })
    const md = reportMarkdown(r)
    expect(md).toContain('## Across genes')
    expect(md).toContain('| Gene | Columns compared | Within the group\'s spread | Nearest |')
    expect(md).toContain('| ATP6 | 100 | North, South | North, South |')
    // The section sits between coverage and conflicts, and the conflicts section still reports the same disagreement.
    expect(md.indexOf('## Coverage')).toBeLessThan(md.indexOf('## Across genes'))
    expect(md.indexOf('## Across genes')).toBeLessThan(md.indexOf('## Conflicting evidence'))
  })

  it('says when genes agree, and when none could be compared', () => {
    const agree = sampleReport(panel, { ...base, geneSummary: geneSummary(query, windows, [finding('n', 'consistent', [fw('cox1', 100, 0, 2), fw('atp6', 100, 0, 2)])])! })
    expect(agree.genes!.summary).toContain('The compared genes don\'t disagree: each shares a nearest group with every other.')
    const none = sampleReport(panel, { ...base, geneSummary: geneSummary(query, windows, [])! })
    expect(none.genes!.summary[0]).toBe('No gene of the 4 in this panel could be compared with this sequence.')
    expect(reportMarkdown(none)).not.toContain('| Gene |')
  })

  it('a result without a summary, such as cytb, gets no section and no key', () => {
    const r = sampleReport(panel, base)
    expect('genes' in r).toBe(false)
    expect(reportMarkdown(r)).not.toContain('Across genes')
  })
})
