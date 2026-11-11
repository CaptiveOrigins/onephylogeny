import { describe, expect, it } from 'vitest'
import {
  HYPOTHESIS_VERDICTS, UNCALIBRATED_NOTE, buildPanel, canonicalJson, evaluateQuery, planTest, runTest,
  type HypothesisArtifacts, type HypothesisClaim, type HypothesisPanel, type HypothesisResult, type PanelBundle, type PanelMember, type ValidationInput,
} from '../src/index.js'

// Hypothesis chat, deterministic core (roadmap stage 9, ADR 0013). Made-up panels whose outcomes follow from how they're
// built: each group differs from the reference at every column whose last digit is its index, and each record carries one
// private difference per window, so groups are 40 of 200 columns apart and records of one group 2 of 200 (1%).

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
const make = (marked: (i: number) => boolean, privateAt: number[] = [], keep: (i: number) => boolean = () => true) =>
  [...R].map((c, i) => (!keep(i) ? '-' : marked(i) !== privateAt.includes(i) ? swap(c) : c)).join('')
const marks = (digit: number) => (i: number) => i % 10 === digit

/**
 * Groups a, b, c: ten records each, each from its own site. Group e has a's sequences, so no column separates a from e.
 * Group d has one record, below the depth of 2, so nothing about it can be evaluated.
 */
function members(groups: string[]): PanelMember[] {
  const digit: Record<string, number> = { a: 0, b: 1, c: 2, e: 0, d: 3 }
  const out: PanelMember[] = []
  for (const g of groups) {
    const count = g === 'd' ? 1 : 10
    for (let k = 0; k < count; k++) out.push({ record: `${g}${k}`, group: g, aligned: make(marks(digit[g]!), [7 + 10 * k, 207 + 10 * k]), provenanceClass: 'wild-documented', block: `site-${g}-${k}` })
  }
  return out
}

const input = (version: string, groups = ['a', 'b', 'c', 'd', 'e']): ValidationInput => ({
  settings: {
    id: 'p', version, groups: groups.map((id) => ({ id, label: id.toUpperCase() })), notCovered: ['Islands'], validatedScope: [],
    windows: [{ id: 'w1', label: 'First', start: 0, end: 200 }, { id: 'w2', label: 'Second', start: 200, end: 400 }],
    rules: { minSharedColumns: 50, minDepthPerColumn: 2, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 },
  },
  taxa: [{ source: 't', id: '1' }], marker: { kind: 'gene', gene: 'g' }, reference: { accession: 'R.1', length: 400 }, sources: [], builtBy: 'gated-records-1', referenceSequence: R, members: members(groups),
})

const panelArtifact = (bundle: PanelBundle, key = `panel-${bundle.panel.version}`): HypothesisPanel => ({ artifact: { type: 'panel', key }, bundle, filesVerified: true })

const QUERIES = {
  /** Group b's pattern: fits b, and decisive sites rule a and c out. */
  likeB: make(marks(1)),
  /** A pattern no group has, 40 of 200 columns from everything. */
  novel: make(marks(5)),
  /** b's pattern in the first window, the novel one in the second. */
  split: make((i) => (i < 200 ? i % 10 === 1 : i % 10 === 5)),
  /** Only 30 columns per window, below the 50 the rules need. */
  short: make(marks(1), [], (i) => i % 200 < 30),
}

let runs = 0
function resultArtifact(sample: string, sequence: string, bundle: PanelBundle, options: { sha?: string | null } = {}): HypothesisResult {
  runs++
  const sha = options.sha === null ? undefined : (options.sha ?? `sha256:${sample}-${sequence.length}-${sequence.slice(0, 30)}`)
  const result = evaluateQuery(sequence, bundle, { queryId: sample, runId: `run-${runs}`, ...(sha ? { querySha256: sha } : {}) })
  return { artifact: { type: 'sample-result', key: `result-${sample}-${bundle.panel.version}-${runs}` }, result, aligned: sequence, filesVerified: true }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

const v1 = buildPanel(input('1'))
const v2 = buildPanel(input('2', ['a', 'c', 'd', 'e']))
const v1again = buildPanel(input('1b'))

const world = (): HypothesisArtifacts => ({
  panels: [panelArtifact(v1)],
  results: [
    resultArtifact('S-likeB', QUERIES.likeB, v1), resultArtifact('S-novel', QUERIES.novel, v1),
    resultArtifact('S-split', QUERIES.split, v1), resultArtifact('S-short', QUERIES.short, v1),
  ],
})

const check = (claim: HypothesisClaim, artifacts: HypothesisArtifacts) => {
  const plan = planTest(claim, artifacts)
  const before = structuredClone(plan)
  const verdict = runTest(plan, artifacts)
  // The stated test is the same before and after running, and comes back unchanged with the verdict.
  expect(plan).toEqual(before)
  expect(verdict.plan).toEqual(before)
  expect(HYPOTHESIS_VERDICTS).toContain(verdict.verdict)
  return { plan, verdict }
}

describe('hypothesis chat: the roadmap check', () => {
  it('says a false claim is refuted, with the finding and the pairs that rule it out', () => {
    const { plan, verdict } = check({ kind: 'sample-in-group', sample: 'S-likeB', group: 'a' }, world())
    expect(plan.testable).toBe(true)
    expect(plan.text).toMatch(/^To test "Sample S-likeB belongs to group a", I will read sample-result result-S-likeB-1-\d+ \(sha256:[0-9a-f]{64}, run run-\d+\); panel panel-1 \(sha256:[0-9a-f]{64}\)\. /)
    expect(plan.text).toMatch(/Not refuted never means confirmed\.$/)
    expect(plan.uses[1]!.rests).toBe('The panel it was made with, panel p version 1 (built from gated-records-1)')
    expect(plan.text).toContain('refuted if the finding is excluded_within_panel')
    expect(verdict.verdict).toBe('refuted')
    expect(verdict.citations[0]).toMatchObject({ artifact: { type: 'sample-result' }, path: expect.stringMatching(/^findings\.\d+$/), rests: expect.stringContaining('Group a: excluded_within_panel (contradicted-outside-spread)') })
    expect(verdict.citations[0]!.run).toMatch(/^run-\d+$/)
    expect(verdict.citations.some((c) => c.path?.startsWith('pairs.') && c.rests.includes('favoring b'))).toBe(true)
    expect(verdict.caveats.join(' ')).toContain('exploratory')
  })

  it('says an untestable claim is untestable, with the reason from the finding', () => {
    const { verdict } = check({ kind: 'sample-in-group', sample: 'S-likeB', group: 'd' }, world())
    expect(verdict.verdict).toBe('untestable with this data')
    expect(verdict.explanation).toMatch(/couldn't be compared .*Needs 1 more records/)
    expect(verdict.citations[0]).toMatchObject({ path: expect.stringMatching(/^findings\./), rests: expect.stringContaining('Group d: not_evaluable (too-few-records)') })
  })
})

describe('sample belongs to group', () => {
  it('is not refuted when consistent, and never says confirmed', () => {
    const { verdict } = check({ kind: 'sample-in-group', sample: 'S-likeB', group: 'b', panel: { id: 'p', version: '1' } }, world())
    expect(verdict.verdict).toBe('not refuted')
    expect(verdict.explanation).toContain('consistent')
    expect(verdict.explanation).toContain("Not refuted isn't confirmed")
    expect(verdict.caveats).toContain("The panel doesn't cover: Islands")
  })

  it('is not refuted when inconclusive, and says it is inconclusive rather than a fit', () => {
    const { verdict } = check({ kind: 'sample-in-group', sample: 'S-novel', group: 'b' }, world())
    expect(verdict.verdict).toBe('not refuted')
    expect(verdict.citations[0]!.rests).toContain('inconclusive (outside-spread-not-contradicted)')
    expect(verdict.caveats.join(' ')).toContain('inconclusive, not consistent')
  })

  it('is untestable, before running, when there is no result, no panel, or no such group', () => {
    const w = world()
    for (const [claim, reason] of [
      [{ kind: 'sample-in-group', sample: 'nobody', group: 'a' }, 'there is no saved result for nobody'],
      [{ kind: 'sample-in-group', sample: 'S-likeB', group: 'a', panel: { id: 'p', version: '9' } }, 'no saved result for S-likeB against panel p version 9'],
      [{ kind: 'sample-in-group', sample: 'S-likeB', group: 'zz' }, "group zz isn't in panel p version 1"],
    ] as const) {
      const { plan, verdict } = check(claim, w)
      expect(plan.testable).toBe(false)
      expect(plan.reason).toContain(reason)
      expect(verdict.verdict).toBe('untestable with this data')
      expect(verdict.explanation).toContain(reason)
    }
    const noPanel = { panels: [], results: w.results }
    expect(planTest({ kind: 'sample-in-group', sample: 'S-likeB', group: 'a' }, noPanel).reason).toContain("panel p version 1 isn't among the loaded panels")
  })

  it("won't pick between results against several panel versions", () => {
    const w = world()
    const both = { panels: [...w.panels, panelArtifact(v2)], results: [...w.results, resultArtifact('S-likeB', QUERIES.likeB, v2)] }
    expect(planTest({ kind: 'sample-in-group', sample: 'S-likeB', group: 'a' }, both).reason).toContain('results against 2 panel versions and the claim names none')
    expect(planTest({ kind: 'sample-in-group', sample: 'S-likeB', group: 'a', panel: { id: 'p', version: '2' } }, both).testable).toBe(true)
  })
})

describe('groups distinct in a window', () => {
  it('is not refuted when fixed sites separate them, citing the pair and its sites', () => {
    const { verdict } = check({ kind: 'groups-distinct', a: 'b', b: 'a', window: 'w1' }, world())
    expect(verdict.verdict).toBe('not refuted')
    expect(verdict.explanation).toContain('40 fixed sites separate b from a in w1')
    expect(verdict.citations[0]).toMatchObject({ artifact: { type: 'panel', key: 'panel-1' }, hash: v1.panel.checksum, path: expect.stringMatching(/^pairs\.\d+$/) })
    expect(verdict.caveats).toContain("This pair is not among the panel's validated claims")
  })

  it('is refuted when no column separates them', () => {
    const { verdict } = check({ kind: 'groups-distinct', a: 'a', b: 'e', window: 'w2' }, world())
    expect(verdict.verdict).toBe('refuted')
    expect(verdict.citations[0]!.rests).toContain('a vs e in w2: no_fixed_sites (10 and 10 records')
  })

  it('is untestable when a group is too thin there, or the window or group is missing', () => {
    const w = world()
    expect(check({ kind: 'groups-distinct', a: 'a', b: 'd', window: 'w1' }, w).verdict).toMatchObject({ verdict: 'untestable with this data', explanation: expect.stringContaining('d lacks 50 columns with 2 records') })
    expect(check({ kind: 'groups-distinct', a: 'a', b: 'b', window: 'w9' }, w).plan.reason).toBe("window w9 isn't in panel p version 1 (it has w1, w2)")
    expect(check({ kind: 'groups-distinct', a: 'a', b: 'zz', window: 'w1' }, w).plan.reason).toBe("group zz isn't in panel p version 1")
    const two = { panels: [...w.panels, panelArtifact(v2)], results: [] }
    expect(check({ kind: 'groups-distinct', a: 'a', b: 'c', window: 'w1' }, two).plan.reason).toBe('2 panels are loaded and the claim names none of them')
  })
})

describe('panel version changed the call', () => {
  const withV2 = () => {
    const w = world()
    return { panels: [...w.panels, panelArtifact(v2), panelArtifact(v1again)], results: [...w.results, resultArtifact('S-likeB', QUERIES.likeB, v2), resultArtifact('S-likeB', QUERIES.likeB, v1again)] }
  }

  it('is not refuted when a status changed, citing both findings', () => {
    const { verdict } = check({ kind: 'panel-changed-call', sample: 'S-likeB', from: { id: 'p', version: '1' }, to: { id: 'p', version: '2' }, group: 'a' }, withV2())
    expect(verdict.verdict).toBe('not refuted')
    expect(verdict.citations.map((c) => c.rests.split('.')[0])).toEqual(['Group a: excluded_within_panel (contradicted-outside-spread)', 'Group a: inconclusive (outside-spread-not-contradicted)'])
    expect(verdict.explanation).toContain("not which version is right")
  })

  it('counts a group in only one version as a change', () => {
    const { verdict } = check({ kind: 'panel-changed-call', sample: 'S-likeB', from: { id: 'p', version: '1' }, to: { id: 'p', version: '2' } }, withV2())
    expect(verdict.verdict).toBe('not refuted')
    expect(verdict.citations.some((c) => c.rests === 'Group b has no finding in panel p version 2')).toBe(true)
  })

  it('is refuted when every status is the same', () => {
    const { verdict } = check({ kind: 'panel-changed-call', sample: 'S-likeB', from: { id: 'p', version: '1' }, to: { id: 'p', version: '1b' } }, withV2())
    expect(verdict.verdict).toBe('refuted')
    expect(verdict.explanation).toBe('Every compared group has the same status against both versions: a excluded_within_panel, b consistent, c excluded_within_panel, d not_evaluable, e excluded_within_panel.')
  })

  it('is untestable when the results tested different sequences, or one has no sequence hash', () => {
    const w = withV2()
    const other = { ...w, results: [...w.results.filter((r) => !(r.result.query === 'S-likeB' && r.result.panel.version === '2')), resultArtifact('S-likeB', QUERIES.likeB, v2, { sha: 'sha256:other' })] }
    expect(planTest({ kind: 'panel-changed-call', sample: 'S-likeB', from: { id: 'p', version: '1' }, to: { id: 'p', version: '2' } }, other).reason).toContain('tested different sequences')
    const noHash = { ...w, results: [...w.results.filter((r) => !(r.result.query === 'S-likeB' && r.result.panel.version === '2')), resultArtifact('S-likeB', QUERIES.likeB, v2, { sha: null })] }
    expect(planTest({ kind: 'panel-changed-call', sample: 'S-likeB', from: { id: 'p', version: '1' }, to: { id: 'p', version: '2' } }, noHash).reason).toContain("doesn't record a hash")
    expect(planTest({ kind: 'panel-changed-call', sample: 'S-likeB', from: { id: 'p', version: '1' }, to: { id: 'p', version: '1' } }, w).reason).toBe('both sides name the same panel version')
  })
})

describe('possibly novel, by the uncalibrated distance rule', () => {
  it('states the rule and that it is uncalibrated before running', () => {
    const plan = planTest({ kind: 'possibly-novel', sample: 'S-novel' }, world())
    expect(plan.method).toMatchObject({ function: 'noveltyByDistance', ruleVersion: 1, calibrated: false })
    expect(plan.text).toContain(UNCALIBRATED_NOTE)
  })

  it('is not refuted beyond the threshold, refuted within it, and says uncalibrated either way', () => {
    const novel = check({ kind: 'possibly-novel', sample: 'S-novel' }, world()).verdict
    expect(novel).toMatchObject({ verdict: 'not refuted', calibrated: false })
    expect(novel.explanation).toMatch(/^Uncalibrated distance rule \(version 1\)/)
    expect(novel.caveats[0]).toBe(UNCALIBRATED_NOTE)
    expect(novel.citations.filter((c) => c.path?.startsWith('distance-novelty.windows.')).map((c) => c.rests.split('.')[0])).toEqual(['Window w1: possibly-novel', 'Window w2: possibly-novel'])
    const known = check({ kind: 'possibly-novel', sample: 'S-likeB' }, world()).verdict
    expect(known).toMatchObject({ verdict: 'refuted', calibrated: false })
    expect(known.explanation).toContain('weak evidence')
  })

  it('is untestable when windows disagree or no window can be tested', () => {
    expect(check({ kind: 'possibly-novel', sample: 'S-split' }, world()).verdict).toMatchObject({ verdict: 'untestable with this data', explanation: expect.stringContaining('windows disagree (w1 within-range, w2 possibly-novel)') })
    expect(check({ kind: 'possibly-novel', sample: 'S-short' }, world()).verdict).toMatchObject({ verdict: 'untestable with this data', explanation: expect.stringContaining('below the minimum of 50') })
  })

  it('is untestable when the result has no aligned sequence', () => {
    const w = world()
    const bare = { ...w, results: w.results.map(({ aligned: _a, ...r }) => r) }
    expect(planTest({ kind: 'possibly-novel', sample: 'S-novel' }, bare).reason).toContain('has no aligned sequence')
  })
})

describe('tool or data problem', () => {
  it('refuses a panel whose sequences no longer match its seal', () => {
    const w = world()
    const tampered: PanelBundle = { ...v1, sequences: { ...v1.sequences, a0: make(marks(1)) } }
    const bad = { panels: [panelArtifact(tampered)], results: w.results }
    const { verdict } = check({ kind: 'sample-in-group', sample: 'S-likeB', group: 'a' }, bad)
    expect(verdict.verdict).toBe('tool or data problem')
    expect(verdict.diagnostics?.map((d) => d.code)).toEqual(['sequences-changed'])
    expect(verdict.citations.length).toBeGreaterThan(0)
  })

  it('refuses an artifact that changed after the test was stated, or whose files the store says changed', () => {
    const w = world()
    const plan = planTest({ kind: 'sample-in-group', sample: 'S-likeB', group: 'a' }, w)
    const edited = { ...w, results: w.results.map((r) => (r.result.query === 'S-likeB' ? { ...r, result: { ...r.result, caveats: [] } } : r)) }
    expect(runTest(plan, edited)).toMatchObject({ verdict: 'tool or data problem', diagnostics: [{ code: 'artifact-changed' }] })
    expect(runTest(plan, { ...w, results: [] })).toMatchObject({ verdict: 'tool or data problem', diagnostics: [{ code: 'artifact-missing' }] })
    const unverified = { ...w, panels: w.panels.map((p) => ({ ...p, filesVerified: false })) }
    expect(runTest(planTest({ kind: 'groups-distinct', a: 'a', b: 'b', window: 'w1' }, unverified), unverified)).toMatchObject({ verdict: 'tool or data problem', diagnostics: [{ code: 'files-changed' }] })
  })

  it('refuses a result that fails its checks against the panel', () => {
    const w = world()
    const broken = w.results.map((r) => (r.result.query === 'S-likeB' ? { ...r, result: { ...r.result, findings: r.result.findings.filter((f) => f.group !== 'c') } } : r))
    const { verdict } = check({ kind: 'sample-in-group', sample: 'S-likeB', group: 'a' }, { ...w, results: broken })
    expect(verdict).toMatchObject({ verdict: 'tool or data problem', diagnostics: [{ code: 'missing-group' }] })
  })

  it("says when the caller didn't check the store's file hashes", () => {
    const w = world()
    const unknown = { panels: w.panels.map(({ filesVerified: _f, ...p }) => p), results: w.results }
    expect(check({ kind: 'groups-distinct', a: 'a', b: 'b', window: 'w1' }, unknown).verdict.caveats.join(' ')).toContain("file hashes weren't checked by the caller for panel panel-1")
  })
})

describe('read only', () => {
  it('writes nothing: every claim runs on frozen artifacts, which come out byte for byte the same', () => {
    const w = world()
    const all = deepFreeze({ panels: [...w.panels, panelArtifact(v2)], results: [...w.results, resultArtifact('S-likeB', QUERIES.likeB, v2)] })
    const before = canonicalJson(all)
    const claims: HypothesisClaim[] = [
      { kind: 'sample-in-group', sample: 'S-likeB', group: 'a', panel: { id: 'p', version: '1' } },
      { kind: 'groups-distinct', a: 'a', b: 'b', window: 'w1', panel: { id: 'p', version: '1' } },
      { kind: 'panel-changed-call', sample: 'S-likeB', from: { id: 'p', version: '1' }, to: { id: 'p', version: '2' } },
      { kind: 'possibly-novel', sample: 'S-novel' },
    ]
    const verdicts = claims.map((c) => check(c, all).verdict.verdict)
    expect(verdicts).toEqual(['refuted', 'not refuted', 'not refuted', 'not refuted'])
    expect(canonicalJson(all)).toBe(before)
  })
})
