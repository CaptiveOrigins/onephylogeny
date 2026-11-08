import { describe, expect, it } from 'vitest'
import { regionCard, REGION_CARD_LABELS, type Panel, type PanelGroup, type Result } from '../src/index.js'

// Invented panel and result: only the fields regionCard reads.
const located = { record: 'r1', use: 'lineage-and-location' as const, provenanceClass: 'wild-documented' as const }
const assigned = { record: 'r2', use: 'lineage-only' as const, provenanceClass: 'unknown' as const }
const claim = { a: 'a', b: 'b', window: 'w', minColumns: 100, sites: { a: 3, b: 3 }, basis: 'exploratory' as const }
const groupA: PanelGroup = { id: 'a', label: 'A', region: 'Northern Region', coverage: [], evidence: [located, assigned] }
const groupB: PanelGroup = { id: 'b', label: 'B', region: 'Southern Region', coverage: [], evidence: [located] }
const panelOf = (over: Partial<Panel> = {}): Panel => ({ id: 'p', version: '1', checksum: 'sha256:x', status: 'active', claims: [claim], groups: [groupA, groupB], ...over } as Panel)
/** The panel with group A changed. */
const withA = (a: Partial<PanelGroup>) => panelOf({ groups: [{ ...groupA, ...a }, groupB] })
const finding = (group: string, status: string) => ({ group, status, reasonCode: 'within-spread', reason: '', overlap: 500, informativeSites: 3, windows: [], evidence: [] })
const resultOf = (p: Panel, over: Partial<Result> = {}): Result => ({
  schemaVersion: 2, query: 'q', run: 'r', overlap: 500, pairs: [], candidatesNotEvaluated: [], caveats: [],
  panel: { id: p.id, version: p.version, checksum: p.checksum! },
  findings: [finding('a', 'consistent'), finding('b', 'excluded_within_panel')],
  novelty: { flagged: false, reasons: [], neitherSideSites: 0 },
  outOfValidatedScope: p.status === 'active' ? [] : [`This panel is ${p.status}, not active`],
  ...over,
} as Result)
const keeper = { audience: 'keeper' as const }

describe('region cards (P30)', () => {
  it('name the matched group\'s region with the approved words and caveat', () => {
    const p = panelOf()
    const card = regionCard(p, resultOf(p), keeper)
    expect(card).toMatchObject({ show: true, group: 'a', regions: ['Northern Region'], label: 'reviewed-exploratory', caveat: 'Not proof of where this animal was collected.' })
    if (!card.show) throw new Error('expected a card')
    expect(card.text).toBe('Reviewed. Claims are exploratory until tested on independent data. Matches a maternal line sampled in Northern Region. Other regions are unsampled or untested. Not proof of where this animal was collected.')
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
    expect(regionCard(p, resultOf(p, { findings: [finding('a', 'consistent'), finding('b', 'consistent')] } as never), keeper)).toEqual({ show: false, reason: 'no-single-match' })
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
    const card = regionCard(p, resultOf(p), { ...keeper, labels: { reviewedExploratory: 'R.', match: 'M {regions}.', caveat: 'C.' } })
    expect(card).toMatchObject({ show: true, text: 'R. M Northern Region. C.', caveat: 'C.' })
  })
})
