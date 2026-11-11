import { describe, expect, it } from 'vitest'
import { DISTANCE_NOVELTY_RULE, evaluateQuery, nearestRank, noveltyByDistance, noveltyGroupLeftOut, unsealedBundle, withinGroupDistances, type PanelMember, type ValidationInput } from '../src/index.js'

// Distance-based novelty, uncalibrated (analysis protocol section 8). Every expected outcome follows from how the
// made-up panel is built, not from a run.

function randomSeq(n: number, seed: number): string {
  let a = seed >>> 0
  let out = ''
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out += 'ACGT'[((t ^ (t >>> 14)) >>> 0) % 4]
  }
  return out
}
const R = randomSeq(400, 7)
const swap = (c: string) => (c === 'A' ? 'C' : 'A')
const GROUPS = ['a', 'b', 'c', 'e'] as const
type G = (typeof GROUPS)[number]
/**
 * Each group differs from the reference at every column whose last digit is its index (20 columns per window), so two
 * groups are 40 of 200 columns apart. Each record also carries one private difference per window, at a column ending in
 * 7 that's its own, so two records of one group are 2 of 200 apart (1%) and every within-group distance is 1%.
 */
const groupMarks = (g: G) => (i: number) => i % 10 === GROUPS.indexOf(g)
const make = (marked: (i: number) => boolean, privateAt: number[] = [], keep: (i: number) => boolean = () => true) =>
  [...R].map((c, i) => (!keep(i) ? '-' : marked(i) !== privateAt.includes(i) ? swap(c) : c)).join('')
const recordSeq = (g: G, k: number) => make(groupMarks(g), [7 + 10 * k, 207 + 10 * k])

let n = 0
const rec = (group: G, k: number, block = `site-${group}-${k}`): PanelMember => {
  n++
  return { record: `r${n}`, group, aligned: recordSeq(group, k), provenanceClass: 'wild-documented', block }
}

const input = (members: PanelMember[], groups: G[] = ['a', 'b', 'c']): ValidationInput => ({
  settings: {
    id: 'p', version: '1', groups: groups.map((id) => ({ id, label: id.toUpperCase() })), notCovered: [], validatedScope: [],
    windows: [{ id: 'w1', label: 'First', start: 0, end: 200 }, { id: 'w2', label: 'Second', start: 200, end: 400 }],
    rules: { minSharedColumns: 50, minDepthPerColumn: 2, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 },
  },
  taxa: [{ source: 't', id: '1' }], marker: { kind: 'gene', gene: 'g' }, reference: { accession: 'R.1', length: 400 }, sources: [], builtBy: 'test', referenceSequence: R, members,
})

/** Ten records per group, each from its own site: 30 within-group distances per window, all 1%. */
const tenEach = (groups: G[] = ['a', 'b', 'c']) => {
  n = 0
  return input(groups.flatMap((g) => Array.from({ length: 10 }, (_, k) => rec(g, k))), groups)
}
const bundleOf = (i: ValidationInput) => unsealedBundle(i)

describe('noveltyByDistance', () => {
  it('takes the 95th percentile by nearest rank, which is the largest value below 20 distances', () => {
    const list = (k: number) => Array.from({ length: k }, (_, i) => i + 1)
    expect(nearestRank(list(20), 0.95)).toBe(19)
    expect(nearestRank(list(100), 0.95)).toBe(95)
    expect(nearestRank(list(19), 0.95)).toBe(19)
    expect(DISTANCE_NOVELTY_RULE.minReferenceDistances).toBe(20)
  })

  it('derives each window threshold from leave-one-site-out nearest-groupmate distances, and says how', () => {
    const r = noveltyByDistance(bundleOf(tenEach()), make(groupMarks('a'), [8, 208]))
    for (const w of r.windows) {
      expect(w.threshold).toEqual({ value: 0.01, percentile: 0.95, distances: 30, groups: 3, method: 'leave-one-site-out-nearest-groupmate' })
      expect(w.referenceDistances).toBe(30)
    }
  })

  it('calls a query inside a group within range, and marks the answer uncalibrated', () => {
    const r = noveltyByDistance(bundleOf(tenEach()), make(groupMarks('a'), [8, 208]))
    expect(r.calibrated).toBe(false)
    expect(r.note).toMatch(/uncalibrated/)
    expect(r.status).toBe('within-range')
    for (const w of r.windows) {
      expect(w.status).toBe('within-range')
      // One private difference each side: 2 of 200, equal to the threshold, which isn't beyond it.
      expect(w.nearest).toMatchObject({ distance: 0.01, differences: 2, overlap: 200, groups: ['a'] })
    }
  })

  it('calls a query far from every group possibly novel', () => {
    const r = noveltyByDistance(bundleOf(tenEach()), make(groupMarks('e')))
    expect(r.status).toBe('possibly-novel')
    for (const w of r.windows) {
      expect(w.status).toBe('possibly-novel')
      expect(w.reasonCode).toBe('beyond-threshold')
      // 20 columns of its own, 20 of the nearest group's, and that record's private one: 41 of 200.
      expect(w.nearest!.differences).toBe(41)
      expect(w.reason).toMatch(/threshold 1%/)
    }
  })

  it('says not evaluable when the query has too few columns, and never guesses', () => {
    const r = noveltyByDistance(bundleOf(tenEach()), make(groupMarks('e'), [], (i) => i % 200 < 30))
    expect(r.status).toBe('not-evaluable')
    for (const w of r.windows) {
      expect(w).toMatchObject({ status: 'not-evaluable', reasonCode: 'too-few-query-columns', queryColumns: 30 })
      expect(w.nearest).toBeUndefined()
    }
  })

  it('says not evaluable when no record shares enough columns with the query', () => {
    n = 0
    // Every panel record covers only columns 0 to 99 and 200 to 299; the query covers only 100 to 199 and 300 to 399.
    const half = (g: G, k: number): PanelMember => ({ ...rec(g, k), aligned: make(groupMarks(g), [7 + 10 * k, 207 + 10 * k], (i) => i % 200 < 100) })
    const panel = input((['a', 'b', 'c'] as G[]).flatMap((g) => Array.from({ length: 10 }, (_, k) => half(g, k))))
    const r = noveltyByDistance(bundleOf(panel), make(groupMarks('e'), [], (i) => i % 200 >= 100))
    expect(r.status).toBe('not-evaluable')
    expect(r.windows.map((w) => w.reasonCode)).toEqual(['no-record-shares-enough-columns', 'no-record-shares-enough-columns'])
  })

  it('says not evaluable when the panel has too few within-group distances for a threshold', () => {
    n = 0
    const panel = input((['a', 'b', 'c'] as G[]).flatMap((g) => Array.from({ length: 6 }, (_, k) => rec(g, k))))
    const r = noveltyByDistance(bundleOf(panel), make(groupMarks('e')))
    expect(18).toBeLessThan(DISTANCE_NOVELTY_RULE.minReferenceDistances)
    expect(r.status).toBe('not-evaluable')
    for (const w of r.windows) {
      expect(w).toMatchObject({ status: 'not-evaluable', reasonCode: 'too-few-reference-distances', referenceDistances: 18 })
      // The nearest record is still reported; only the threshold is missing.
      expect(w.nearest!.differences).toBe(41)
      expect(w.threshold).toBeUndefined()
    }
  })

  it('reports windows that disagree as such, rather than picking one', () => {
    const query = make((i) => (i < 200 ? groupMarks('a')(i) : groupMarks('e')(i)), [8])
    const r = noveltyByDistance(bundleOf(tenEach()), query)
    expect(r.windows.map((w) => w.status)).toEqual(['within-range', 'possibly-novel'])
    expect(r.status).toBe('windows-disagree')
  })

  it('leaves out records from the same site, so duplicates there do not pull the threshold to zero', () => {
    n = 0
    // Each site holds two identical records. Counting a sitemate would make every within-group distance 0.
    const panel = input((['a', 'b', 'c'] as G[]).flatMap((g) => Array.from({ length: 10 }, (_, k) => [rec(g, k), rec(g, k)]).flat()))
    const ref = withinGroupDistances(bundleOf(panel), { id: 'w1', label: 'First', start: 0, end: 200 })
    expect(ref.distances).toHaveLength(60)
    expect(Math.min(...ref.distances)).toBe(0.01)
  })

  it('counts records without a site as one site per group, so they give no within-group distance among themselves', () => {
    n = 0
    const panel = input((['a', 'b', 'c'] as G[]).flatMap((g) => Array.from({ length: 10 }, (_, k) => ({ ...rec(g, k), block: undefined }))))
    const ref = withinGroupDistances(bundleOf(panel), { id: 'w1', label: 'First', start: 0, end: 200 })
    expect(ref.distances).toHaveLength(0)
  })

  it('is not wired into results: the evaluator neither runs it nor changes the novelty flag', () => {
    const bundle = bundleOf(tenEach())
    const query = make(groupMarks('a'), [8, 208])
    const result = evaluateQuery(query, bundle, { queryId: 'q', runId: 'r' })
    expect(Object.keys(result).some((k) => /distance/i.test(k))).toBe(false)
    expect(result.novelty.flagged).toBe(false)
  })
})

describe('noveltyGroupLeftOut (an uncalibrated check, not a pass or fail)', () => {
  it('counts each removed group\'s records by outcome; distinct groups come out possibly novel', () => {
    const check = noveltyGroupLeftOut(tenEach())
    expect(check.calibrated).toBe(false)
    expect(check.note).toMatch(/not a pass or fail/)
    // Removing a group leaves 20 within-group distances per window, just enough for a threshold.
    expect(check.totals).toEqual({ group: 'all', tested: 30, 'possibly-novel': 30, 'within-range': 0, 'windows-disagree': 0, 'not-evaluable': 0 })
  })

  it('counts a removed group that sits inside another as within range, so the check can come out either way', () => {
    n = 0
    // d copies a's sequences exactly, so with d removed its records sit within a's range, and the reverse.
    const base = tenEach()
    const d = Array.from({ length: 10 }, (_, k): PanelMember => ({ ...rec('a', k, `site-d-${k}`), group: 'd' }))
    const panel = { ...base, members: [...base.members, ...d], settings: { ...base.settings, groups: [...base.settings.groups, { id: 'd', label: 'D' }] } }
    const check = noveltyGroupLeftOut(panel)
    const row = (g: string) => check.rows.find((r) => r.group === g)!
    expect(row('a')).toMatchObject({ tested: 10, 'within-range': 10 })
    expect(row('d')).toMatchObject({ tested: 10, 'within-range': 10 })
    expect(row('b')).toMatchObject({ tested: 10, 'possibly-novel': 10 })
  })
})
