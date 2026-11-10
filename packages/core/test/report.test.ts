import { describe, expect, it } from 'vitest'
import { NO_REGION_TEXT, REGION_CARD_LABELS, reportMarkdown, sampleReport, type Panel, type PanelGroup, type Result } from '../src/index.js'

// Invented panel and result, shaped like the region card's tests, with the fields a report also reads.
const located = { record: 'r1', use: 'lineage-and-location' as const, provenanceClass: 'wild-documented' as const }
const claim = { a: 'a', b: 'b', window: 'w', minColumns: 100, sites: { a: 3, b: 3 }, basis: 'exploratory' as const }
const groupA: PanelGroup = { id: 'a', label: 'Group A', region: 'Northern Region', coverage: [], evidence: [located] }
const groupB: PanelGroup = { id: 'b', label: 'Group B', region: 'Southern Region', coverage: [], evidence: [located] }
const groupC: PanelGroup = { id: 'c', label: 'Group C', region: 'Eastern Region', coverage: [], evidence: [located] }
const panelOf = (over: Partial<Panel> = {}): Panel =>
  ({ id: 'p', version: '1', checksum: 'sha256:x', status: 'active', claims: [claim], groups: [groupA, groupB, groupC], notCovered: ['Western islands'], sources: [{ citation: 'Author (2025) A study.', url: 'https://doi.org/10.0/x' }], ...over }) as Panel
const pair = (a: string, b: string, state: string, favors?: string) => ({ a, b, state, reasonCode: state === 'resolved' ? 'decisive-sites' : 'group-not-evaluable', ...(favors ? { favors } : {}), sitesCovered: 3, forA: 3, forB: 0, neither: 0, ambiguous: 0 })
const finding = (group: string, status: string, reason = 'Within the group\'s spread') => ({ group, status, reasonCode: 'within-spread', reason, overlap: 500, informativeSites: 3, windows: [], evidence: [] })
const resultOf = (p: Panel, over: Partial<Result> = {}): Result =>
  ({
    schemaVersion: 2, query: 'kit-123', run: 'run-9', overlap: 500, candidatesNotEvaluated: ['c'], caveats: ['Rules are configured values and these statuses are not probabilities'],
    querySha256: 'sha256:q', producedBy: [{ name: 'onephylogeny-engine', version: '0.1.0-alpha.5' }],
    pairs: [pair('a', 'b', 'resolved', 'a'), pair('a', 'c', 'not_evaluable'), pair('b', 'c', 'not_evaluable')],
    panel: { id: p.id, version: p.version, checksum: p.checksum! },
    findings: [finding('a', 'consistent'), finding('b', 'excluded_within_panel', 'Decisive sites favour another group'), finding('c', 'not_evaluable', 'Too few records')],
    novelty: { flagged: false, reasons: [], neitherSideSites: 0 },
    outOfValidatedScope: p.status === 'active' ? [] : [`This panel is ${p.status}, not active`],
    ...over,
  }) as Result

describe('sample report (roadmap stage 2)', () => {
  it('names a region only with the card\'s words, label and caveat', () => {
    const p = panelOf()
    const r = sampleReport(p, resultOf(p))
    expect(r.conclusion).toEqual({ regionNamed: true, label: REGION_CARD_LABELS.reviewedExploratory, text: 'Closer to the maternal line population sampled in Northern Region than those in Southern Region. Other regions are unsampled or untested.', caveat: REGION_CARD_LABELS.caveat })
  })

  it('labels a candidate panel exploratory', () => {
    const p = panelOf({ status: 'candidate' })
    expect(sampleReport(p, resultOf(p)).conclusion.label).toBe(REGION_CARD_LABELS.exploratory)
  })

  it('says in plain words why no region is named', () => {
    const p = panelOf()
    const two = sampleReport(p, resultOf(p, { findings: [finding('a', 'consistent'), finding('b', 'consistent'), finding('c', 'not_evaluable')] } as never))
    expect(two.conclusion).toMatchObject({ regionNamed: false, text: NO_REGION_TEXT['no-single-match'] })
    expect(two.conclusion.caveat).toMatch(/never proof of where an animal was collected/)
    expect(sampleReport(p, resultOf(panelOf({ version: '2' }))).conclusion.text).toBe(NO_REGION_TEXT['wrong-panel'])
  })

  it('carries the reasons, coverage, gaps, versions and sources', () => {
    const p = panelOf()
    const r = sampleReport(p, resultOf(p))
    expect(r.groups.map((g) => [g.label, g.statusText])).toEqual([['Group A', 'Consistent'], ['Group B', 'Ruled out within this panel'], ['Group C', "Couldn't be compared"]])
    expect(r.comparisons[0]).toEqual({ pair: 'Group A vs Group B', outcome: 'Favours Group A (decisive-sites)' })
    expect(r.coverage).toEqual({ columnsCompared: 500, notEvaluated: ['Group C'] })
    expect(r.gaps).toEqual(expect.arrayContaining(['This panel does not cover: Western islands', "The true group could be one that wasn't evaluated: Group C", 'Rules are configured values and these statuses are not probabilities']))
    expect(r.versions).toEqual({ panel: 'p 1', checksum: 'sha256:x', panelStatus: 'active', run: 'run-9', query: 'kit-123', querySha256: 'sha256:q', producedBy: ['onephylogeny-engine 0.1.0-alpha.5'] })
    expect(r.citations).toEqual(['Author (2025) A study. https://doi.org/10.0/x'])
  })

  it('shows conflicting evidence in its own section, and none for a clean result', () => {
    const p = panelOf()
    expect(sampleReport(p, resultOf(p)).conflicts).toEqual([])
    const two = sampleReport(p, resultOf(p, { findings: [finding('a', 'consistent'), finding('b', 'consistent'), finding('c', 'not_evaluable')] } as never))
    expect(two.conflicts).toEqual(['More than one group fits this sequence: Group A, Group B.'])
    expect(reportMarkdown(two)).toContain('## Conflicting evidence')
  })

  it('says each gap once, even when the result already carries it', () => {
    const p = panelOf()
    const r = sampleReport(p, resultOf(p, { caveats: ['Group C could not be evaluated, so this result says nothing about it', 'This panel does not cover: Western islands'] }))
    expect(r.gaps.filter((g) => g.startsWith('This panel does not cover'))).toHaveLength(1)
    expect(r.gaps).toContain('Group C could not be evaluated, so this result says nothing about it')
  })

  it('flags a sequence no group fits', () => {
    const p = panelOf()
    const r = sampleReport(p, resultOf(p, { findings: [finding('a', 'inconclusive'), finding('b', 'inconclusive'), finding('c', 'not_evaluable')], novelty: { flagged: true, reasons: ['no-consistent-group'], neitherSideSites: 2 } } as never))
    expect(r.gaps.some((g) => /lineage the panel doesn't have/.test(g))).toBe(true)
  })

  it('prints as Markdown that reads without the tool, and never shows a position', () => {
    const p = panelOf()
    const md = reportMarkdown(sampleReport(p, resultOf(p)))
    expect(md).toMatch(/^# kit-123 against p 1\n/)
    for (const h of ['## Conclusion', '## Groups', '## Comparisons between groups', '## Coverage', '## Gaps and caveats', '## Versions', '## Sources']) expect(md).toContain(h)
    expect(md).toContain('*Not proof of where this animal was collected.*')
    expect(md).not.toContain('Eastern Region')
    const sneaky = panelOf({ groups: [{ ...groupA, region: '-3.4653, -62.2159' }, groupB, groupC] })
    const hidden = reportMarkdown(sampleReport(sneaky, resultOf(sneaky)))
    expect(hidden).not.toMatch(/-?\d{1,3}\.\d{2,}/)
    expect(hidden).toContain(NO_REGION_TEXT['region-looks-like-coordinates'])
  })

  it('escapes table cells, so a reason with a bar or a line break keeps the table whole', () => {
    const p = panelOf()
    const md = reportMarkdown(sampleReport(p, resultOf(p, { findings: [finding('a', 'consistent', 'one | two\nthree'), finding('b', 'excluded_within_panel'), finding('c', 'not_evaluable')] } as never)))
    expect(md).toContain('one \\| two three')
  })
})
