import { describe, expect, it } from 'vitest'
import { classifyOutcome, clopperPearson, fullValidation, leaveOneStudyOutByWindow, OUTCOME_INTERVAL, perWindowValidation, type OutcomeCounts, type PanelMember, type Result, type ValidationInput } from '../src/index.js'

// Stronger validation (roadmap stage 4.3). Every expected count here follows from how the panel is built, not from a run.

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
const R = randomSeq(400, 11)
const swap = (c: string) => (c === 'A' ? 'C' : 'A')
// Two differences per group, all in w1. w2 is the same in every record, and w3 is never sequenced.
const MARKS: Record<string, number[]> = { a: [10, 20], b: [30, 40], c: [50, 60], d: [70, 80] }
const haplotype = (group: string) => [...R].map((c, i) => (i >= 300 ? '-' : MARKS[group]!.includes(i) ? swap(c) : c)).join('')

let n = 0
const rec = (group: string, study: string | undefined, seqOf = group): PanelMember => {
  n++
  return { record: `r${n}`, group, aligned: haplotype(seqOf), provenanceClass: 'wild-documented', block: `site-${n}`, ...(study ? { study } : {}) }
}
const times = (k: number, f: () => PanelMember) => Array.from({ length: k }, f)

const input = (members: PanelMember[]): ValidationInput => ({
  settings: {
    id: 'p', version: '1', groups: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })), notCovered: [], validatedScope: [],
    windows: [{ id: 'w1', label: 'Differs', start: 0, end: 150 }, { id: 'w2', label: 'Identical', start: 150, end: 300 }, { id: 'w3', label: 'Unsequenced', start: 300, end: 400 }],
    rules: { minSharedColumns: 50, minDepthPerColumn: 2, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 },
    controls: { shuffles: 1, simulations: 1, seed: 3 },
  },
  taxa: [{ source: 't', id: '1' }], marker: { kind: 'gene', gene: 'g' }, reference: { accession: 'R.1', length: 400 }, sources: [], builtBy: 'test', referenceSequence: R, members,
})

/**
 * a: 3 in P1, 3 in P2, and 1 with no study. b: 3 in P1, 3 in P2. c: 3, all in P3 (a single-study group).
 * d: 3 in P1 and 1 in P5, so leaving out P1 leaves d one record, below a depth of 2. Every record is its own site.
 */
const panel = () => {
  n = 0
  return input([
    ...times(3, () => rec('a', 'P1')), ...times(3, () => rec('a', 'P2')), rec('a', undefined),
    ...times(3, () => rec('b', 'P1')), ...times(3, () => rec('b', 'P2')),
    ...times(3, () => rec('c', 'P3')),
    ...times(3, () => rec('d', 'P1')), rec('d', 'P5'),
  ])
}
const zero: OutcomeCounts = { tests: 0, namedTruth: 0, namedTruthAllCompared: 0, truthKeptNotNamed: 0, wrong: 0, unresolved: 0, notEvaluable: 0 }
const counts = (o: Partial<OutcomeCounts>) => ({ ...zero, ...o })

describe('intervals', () => {
  it('match published Clopper-Pearson values', () => {
    // R's binom.test: 0/10 is 0 to 0.3085, 5/10 is 0.1871 to 0.8129, 10/10 is 0.6915 to 1, 1/4 is 0.0063 to 0.8059.
    const cases: [number, number, number, number][] = [[0, 10, 0, 0.308501], [5, 10, 0.187086, 0.812914], [10, 10, 0.691499, 1], [1, 4, 0.006309, 0.805880]]
    for (const [x, of, lo, hi] of cases) {
      const [l, u] = clopperPearson(x, of)
      expect(l).toBeCloseTo(lo, 5)
      expect(u).toBeCloseTo(hi, 5)
    }
  })
  it('are named in the report', () => {
    expect(leaveOneStudyOutByWindow(panel()).interval).toEqual({ method: 'clopper-pearson', level: 0.95, on: 'tests' })
    expect(perWindowValidation(panel()).interval).toBe(OUTCOME_INTERVAL)
  })
})

describe('classifyOutcome', () => {
  const result = (statuses: Record<string, 'consistent' | 'inconclusive' | 'excluded_within_panel' | 'not_evaluable'>, flagged = false) => ({
    findings: Object.entries(statuses).map(([group, status]) => ({ group, status })),
    candidatesNotEvaluated: Object.entries(statuses).filter(([, s]) => s === 'not_evaluable').map(([g]) => g),
    novelty: { flagged, reasons: [], neitherSideSites: 0 },
  }) as unknown as Result
  const one = (r: Result) => classifyOutcome(r, 't', { ...zero })
  it('puts each result in exactly one outcome, in the stated order', () => {
    expect(one(result({ t: 'consistent', o: 'excluded_within_panel' }))).toEqual(counts({ tests: 1, namedTruth: 1, namedTruthAllCompared: 1 }))
    expect(one(result({ t: 'consistent', o: 'not_evaluable' }))).toEqual(counts({ tests: 1, namedTruth: 1 }))
    expect(one(result({ t: 'consistent', o: 'excluded_within_panel' }, true))).toEqual(counts({ tests: 1, truthKeptNotNamed: 1 }))
    expect(one(result({ t: 'consistent', o: 'consistent' }))).toEqual(counts({ tests: 1, truthKeptNotNamed: 1 }))
    expect(one(result({ t: 'excluded_within_panel', o: 'inconclusive' }))).toEqual(counts({ tests: 1, wrong: 1 }))
    expect(one(result({ t: 'inconclusive', o: 'consistent' }))).toEqual(counts({ tests: 1, wrong: 1 }))
    // Pointing somewhere else is wrong even when the truth couldn't be compared.
    expect(one(result({ t: 'not_evaluable', o: 'consistent' }))).toEqual(counts({ tests: 1, wrong: 1 }))
    expect(one(result({ t: 'not_evaluable', o: 'inconclusive' }))).toEqual(counts({ tests: 1, notEvaluable: 1 }))
    expect(one(result({ t: 'inconclusive', o: 'excluded_within_panel' }))).toEqual(counts({ tests: 1, unresolved: 1 }))
  })
})

describe('leaveOneStudyOutByWindow', () => {
  const r = leaveOneStudyOutByWindow(panel())
  const row = (study: string, group: string, window: string) => r.rows.find((x) => x.study === study && x.group === group && x.window === window)
  const total = (group: string, window: string) => r.totals.find((x) => x.group === group && x.window === window)!

  it('names every study, and counts records without one instead of testing them', () => {
    expect(r.studies).toEqual(['P1', 'P2', 'P3', 'P5'])
    expect(r.recordsWithoutStudy).toBe(1)
    expect(r.diagnostics.map((d) => d.code)).toContain('records-without-study')
  })
  it('tests a study against a panel built without it', () => {
    // Without P1, d keeps one record and can't be compared, so P1's records are named right but not with every group compared.
    expect(row('P1', 'a', 'w1')).toMatchObject({ testable: true, records: 3, notTestable: 0, sites: 3, outcomes: counts({ tests: 3, namedTruth: 3 }) })
    expect(row('P2', 'a', 'w1')).toMatchObject({ testable: true, outcomes: counts({ tests: 3, namedTruth: 3, namedTruthAllCompared: 3 }) })
    expect(row('P5', 'd', 'w1')).toMatchObject({ testable: true, outcomes: counts({ tests: 1, namedTruth: 1, namedTruthAllCompared: 1 }) })
  })
  it('reports a single-study group as not testable, never dropped', () => {
    expect(row('P3', 'c', 'w1')).toMatchObject({ testable: false, records: 3, notTestable: 3, outcomes: zero })
    expect(row('P3', 'c', 'w1')!.reason).toContain('No record of c')
    expect(row('P3', 'c', 'w1')!.truthKept).toBeUndefined()
    expect(r.diagnostics.find((d) => d.code === 'single-study-group')!.ids).toEqual(['c'])
    expect(total('c', 'w1')).toMatchObject({ records: 3, notTestable: 3, outcomes: zero })
    expect(total('c', 'w1').truthKept).toBeUndefined()
  })
  it('reports a study whose removal leaves its group below depth as not testable', () => {
    expect(row('P1', 'd', 'w1')).toMatchObject({ testable: false, records: 3, notTestable: 3 })
    expect(row('P1', 'd', 'w1')!.reason).toContain('keeps 1 records')
    expect(r.diagnostics.map((d) => d.code)).toContain('study-not-testable')
  })
  it('gives a window with no separating sites no named result', () => {
    expect(row('P2', 'b', 'w2')).toMatchObject({ testable: true, outcomes: counts({ tests: 3, truthKeptNotNamed: 3 }) })
    expect(r.rows.filter((x) => x.window === 'w3')).toEqual([])
    expect(total('a', 'w3')).toMatchObject({ records: 0, outcomes: zero })
    expect(total('a', 'w3').truthKept).toBeUndefined()
  })
  it('sums studies per group and window, with exact intervals on tests', () => {
    const a = total('a', 'w1')
    expect(a).toMatchObject({ records: 6, notTestable: 0, sites: 6, outcomes: counts({ tests: 6, namedTruth: 6, namedTruthAllCompared: 3 }) })
    expect(a.truthKept!.count).toBe(6)
    expect(a.truthKept!.of).toBe(6)
    expect(a.truthKept!.lower).toBeCloseTo(0.025 ** (1 / 6), 5)
    expect(a.truthKept!.upper).toBe(1)
    expect(a.wrong).toMatchObject({ count: 0, of: 6, lower: 0 })
    expect(total('d', 'w1')).toMatchObject({ records: 4, notTestable: 3, outcomes: counts({ tests: 1, namedTruth: 1, namedTruthAllCompared: 1 }) })
  })
  it('counts a study that disagrees as wrong', () => {
    n = 100
    const p = panel()
    // P4 labels two records b that carry a's haplotype. Without P4, the panel's b is clean and points both to a.
    p.members.push(rec('b', 'P4', 'a'), rec('b', 'P4', 'a'))
    const bad = leaveOneStudyOutByWindow(p).rows.find((x) => x.study === 'P4' && x.window === 'w1')!
    expect(bad).toMatchObject({ group: 'b', testable: true, outcomes: counts({ tests: 2, wrong: 2 }) })
    expect(bad.wrong!.lower).toBeCloseTo(0.025 ** (1 / 2), 5)
    expect(bad.truthKept).toMatchObject({ count: 0, of: 2 })
  })
  it('is deterministic', () => {
    expect(JSON.stringify(leaveOneStudyOutByWindow(panel()))).toBe(JSON.stringify(leaveOneStudyOutByWindow(panel())))
  })
})

describe('perWindowValidation', () => {
  const r = perWindowValidation(panel())
  const win = (id: string) => r.windows.find((w) => w.window === id)!
  const row = (w: string, g: string) => win(w).rows.find((x) => x.group === g)!

  it('lists every window and every group, in settings order', () => {
    expect(r.windows.map((w) => w.window)).toEqual(['w1', 'w2', 'w3'])
    for (const w of r.windows) expect(w.rows.map((x) => x.group)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('holds out each site and counts outcomes in its window', () => {
    expect(win('w1').separatingSites).toBe(8)
    expect(row('w1', 'a')).toMatchObject({ records: 7, sites: 7, outcomes: counts({ tests: 7, namedTruth: 7, namedTruthAllCompared: 7 }) })
    // c has three sites, so holding one out leaves two, which is still the depth these rules need.
    expect(row('w1', 'c')).toMatchObject({ records: 3, notTestable: 0, outcomes: counts({ tests: 3, namedTruth: 3, namedTruthAllCompared: 3 }) })
    expect(row('w1', 'c').namedTruth!.lower).toBeCloseTo(0.025 ** (1 / 3), 5)
  })
  it('reports a window with no separating sites, and one with nothing to test', () => {
    expect(win('w2').separatingSites).toBe(0)
    expect(row('w2', 'b')).toMatchObject({ records: 6, outcomes: counts({ tests: 6, truthKeptNotNamed: 6 }) })
    expect(row('w2', 'b').namedTruth).toMatchObject({ count: 0, of: 6, lower: 0 })
    expect(win('w3').separatingSites).toBe(0)
    for (const x of win('w3').rows) {
      expect(x).toMatchObject({ records: 0, notTestable: 0, sites: 0, outcomes: zero })
      expect(x.truthKept).toBeUndefined()
    }
    expect(r.diagnostics.filter((d) => d.code === 'no-separating-sites').map((d) => d.ids)).toEqual([['w2'], ['w3']])
  })
  it('counts a group left below depth by a held-out site as not testable', () => {
    n = 200
    const p = panel()
    // e has two sites. Holding one out leaves one record, below a depth of 2.
    p.settings.groups.push({ id: 'e', label: 'E' })
    MARKS.e = [90, 100]
    p.members.push(rec('e', 'P6'), rec('e', 'P6'))
    expect(perWindowValidation(p).windows[0]!.rows.find((x) => x.group === 'e')).toMatchObject({ records: 2, notTestable: 2, outcomes: zero })
    delete MARKS.e
  })
})

describe('fullValidation', () => {
  it('carries both new reports', { timeout: 60000 }, () => {
    const v = fullValidation(panel())
    expect(v.studyOut!.scheme).toBe('leave-one-study-out-by-window')
    expect(v.windows!.scheme).toBe('leave-one-site-out-by-window')
  })
})
