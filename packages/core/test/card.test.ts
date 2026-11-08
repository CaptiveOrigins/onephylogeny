import { describe, expect, it } from 'vitest'
import { regionCard, REGION_CARD_LABELS, type Panel, type PanelGroup, type Result } from '../src/index.js'

// Invented panel and result: only the fields regionCard reads.
const located = { record: 'r1', use: 'lineage-and-location' as const, provenanceClass: 'wild-documented' as const }
const assigned = { record: 'r2', use: 'lineage-only' as const, provenanceClass: 'unknown' as const }
const claim = { a: 'a', b: 'b', window: 'w', minColumns: 100, sites: { a: 3, b: 3 }, basis: 'exploratory' as const }
const groupA: PanelGroup = { id: 'a', label: 'A', region: 'Northern Region', coverage: [], evidence: [located, assigned] }
const groupB: PanelGroup = { id: 'b', label: 'B', region: 'Southern Region', coverage: [], evidence: [located] }
const groupC: PanelGroup = { id: 'c', label: 'C', region: 'Eastern Region', coverage: [], evidence: [located] }
const panelOf = (over: Partial<Panel> = {}): Panel => ({ id: 'p', version: '1', checksum: 'sha256:x', status: 'active', claims: [claim], groups: [groupA, groupB, groupC], ...over } as Panel)
/** The panel with group A changed. */
const withA = (a: Partial<PanelGroup>) => panelOf({ groups: [{ ...groupA, ...a }, groupB, groupC] })
const pair = (a: string, b: string, state: string, favors?: string) => ({ a, b, state, reasonCode: 'decisive-sites', ...(favors ? { favors } : {}), sitesCovered: 3, forA: 3, forB: 0, neither: 0, ambiguous: 0 })
const finding = (group: string, status: string) => ({ group, status, reasonCode: 'within-spread', reason: '', overlap: 500, informativeSites: 3, windows: [], evidence: [] })
const resultOf = (p: Panel, over: Partial<Result> = {}): Result => ({
  schemaVersion: 2, query: 'q', run: 'r', overlap: 500, candidatesNotEvaluated: ['c'], caveats: [],
  // A beats B; C couldn't be compared, so the card must not name it.
  pairs: [pair('a', 'b', 'resolved', 'a'), pair('a', 'c', 'not_evaluable'), pair('b', 'c', 'not_evaluable')],
  panel: { id: p.id, version: p.version, checksum: p.checksum! },
  findings: [finding('a', 'consistent'), finding('b', 'excluded_within_panel'), finding('c', 'not_evaluable')],
  novelty: { flagged: false, reasons: [], neitherSideSites: 0 },
  outOfValidatedScope: p.status === 'active' ? [] : [`This panel is ${p.status}, not active`],
  ...over,
} as Result)
const keeper = { audience: 'keeper' as const }

describe('region cards (P30)', () => {
  it('name the closer region and only the regions it was resolved against', () => {
    const p = panelOf()
    const card = regionCard(p, resultOf(p), keeper)
    expect(card).toMatchObject({ show: true, group: 'a', regions: ['Northern Region'], others: ['Southern Region'], label: 'reviewed-exploratory', caveat: 'Not proof of where this animal was collected.' })
    if (!card.show) throw new Error('expected a card')
    expect(card.text).toBe('Reviewed. Claims are exploratory until tested on independent data. Closer to the maternal line sampled in Northern Region than to those sampled in Southern Region. Other regions are unsampled or untested. Not proof of where this animal was collected.')
    expect(card.text).not.toContain('Eastern Region')
  })

  it('stay off when no comparison resolved, or one favored another group', () => {
    const p = panelOf()
    expect(regionCard(p, resultOf(p, { pairs: [pair('a', 'b', 'not_resolved'), pair('a', 'c', 'not_evaluable')] } as never), keeper)).toEqual({ show: false, reason: 'no-resolved-comparison' })
    expect(regionCard(p, resultOf(p, { pairs: [pair('a', 'b', 'resolved', 'a'), pair('a', 'c', 'resolved', 'c')] } as never), keeper)).toEqual({ show: false, reason: 'conflicting-comparisons' })
    const noRegionB = panelOf({ groups: [groupA, { ...groupB, region: undefined }, groupC] })
    expect(regionCard(noRegionB, resultOf(noRegionB), keeper)).toEqual({ show: false, reason: 'no-resolved-comparison' })
    const assignedB = panelOf({ groups: [groupA, { ...groupB, evidence: [assigned] }, groupC] })
    expect(regionCard(assignedB, resultOf(assignedB), keeper)).toEqual({ show: false, reason: 'no-resolved-comparison' })
  })

  it('keep the exploratory label for a result made against a candidate', () => {
    const candidate = panelOf({ status: 'candidate' })
    const made = resultOf(candidate)
    const card = regionCard(panelOf(), made, { ...keeper, madeAgainst: 'candidate' })
    expect(card).toMatchObject({ show: true, label: 'exploratory' })
    expect(regionCard(panelOf(), made, keeper)).toEqual({ show: false, reason: 'outside-validated-scope' })
    expect(regionCard(candidate, resultOf(candidate), { ...keeper, exploratoryShown: true, madeAgainst: 'active' })).toEqual({ show: false, reason: 'made-against-other-status' })
  })

  it('show an exploratory candidate only when a maintainer chose to, and label it', () => {
    const p = panelOf({ status: 'candidate' })
    expect(regionCard(p, resultOf(p), keeper)).toEqual({ show: false, reason: 'candidate-not-shown' })
    const card = regionCard(p, resultOf(p), { ...keeper, exploratoryShown: true })
    expect(card).toMatchObject({ show: true, label: 'exploratory' })
    if (!card.show) throw new Error('expected a card')
    expect(card.text.startsWith(REGION_CARD_LABELS.exploratory)).toBe(true)
    expect(card.text).toContain(REGION_CARD_LABELS.caveat)
  })

  it('drop the exploratory label only when every claim is confirmatory', () => {
    const p = panelOf({ claims: [{ ...claim, basis: 'confirmatory' }] })
    const card = regionCard(p, resultOf(p), keeper)
    expect(card).toMatchObject({ show: true, label: 'reviewed' })
    if (!card.show) throw new Error('expected a card')
    expect(card.text).not.toMatch(/xploratory/)
    expect(card.text).toContain(REGION_CARD_LABELS.caveat)
  })

  it('need the keeper\'s opt-in before anyone else sees regions', () => {
    const p = panelOf()
    expect(regionCard(p, resultOf(p), { audience: 'public' })).toEqual({ show: false, reason: 'not-opted-in' })
    expect(regionCard(p, resultOf(p), { audience: 'public', publicOptIn: false })).toEqual({ show: false, reason: 'not-opted-in' })
    expect(regionCard(p, resultOf(p), { audience: 'public', publicOptIn: true }).show).toBe(true)
  })

  it('never show coordinates, only region names', () => {
    for (const region of ['3.4651, -62.2159', '3°27\'N 62°13\'W', '4 N', 'lat 3.4']) {
      const p = withA({ region })
      expect(regionCard(p, resultOf(p), keeper)).toEqual({ show: false, reason: 'region-looks-like-coordinates' })
    }
  })

  it('use only records that can show where a group occurs, never assigned ones (P12)', () => {
    const p = withA({ evidence: [assigned] })
    expect(regionCard(p, resultOf(p), keeper)).toEqual({ show: false, reason: 'no-located-records' })
    const lineageOnly = withA({ evidence: [{ ...located, use: 'lineage-only' }] })
    expect(regionCard(lineageOnly, resultOf(lineageOnly), keeper)).toEqual({ show: false, reason: 'no-located-records' })
    const unsourced = withA({ evidence: [{ ...located, provenanceClass: 'origin-reported' }] })
    expect(regionCard(unsourced, resultOf(unsourced), keeper)).toEqual({ show: false, reason: 'no-located-records' })
  })

  it('stay off when the match is ambiguous, novel, out of scope or from another panel', () => {
    const p = panelOf()
    expect(regionCard(p, resultOf(p, { findings: [finding('a', 'consistent'), finding('b', 'consistent'), finding('c', 'not_evaluable')] } as never), keeper)).toEqual({ show: false, reason: 'no-single-match' })
    expect(regionCard(p, resultOf(p, { novelty: { flagged: true, reasons: ['no-consistent-group'], neitherSideSites: 0 } }), keeper)).toEqual({ show: false, reason: 'no-single-match' })
    expect(regionCard(p, resultOf(p, { outOfValidatedScope: ['This sequence resolves none of the validated claims'] }), keeper)).toEqual({ show: false, reason: 'outside-validated-scope' })
    expect(regionCard(panelOf({ claims: [] }), resultOf(panelOf({ claims: [] })), keeper)).toEqual({ show: false, reason: 'outside-validated-scope' })
    expect(regionCard(p, resultOf(panelOf({ version: '2' })), keeper)).toEqual({ show: false, reason: 'wrong-panel' })
    for (const status of ['superseded', 'withdrawn'] as const) {
      const old = panelOf({ status })
      expect(regionCard(old, resultOf(old), { ...keeper, exploratoryShown: true })).toEqual({ show: false, reason: 'panel-not-current' })
    }
  })

  it('take translated words from the host', () => {
    const p = panelOf()
    const card = regionCard(p, resultOf(p), { ...keeper, labels: { reviewedExploratory: 'R.', match: 'M {regions} / {others}.', caveat: 'C.' } })
    expect(card).toMatchObject({ show: true, text: 'R. M Northern Region / Southern Region. C.', caveat: 'C.' })
  })
})
