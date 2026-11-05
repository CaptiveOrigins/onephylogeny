import { basesOf } from './sequence.js'
import { evaluateQuery, leaveOneBlockOut, leaveOneGroupOut, holdOut, locates, unsealedBundle, type BuildPanelInput, type PanelMember, type ValidationInput, type ValidationReport } from './build.js'
import type { Id, PanelSettings, PanelWindow, ValidatedClaim } from './model.js'
import { wholeMarker } from './derive.js'

/** The gates and ladders in docs/architecture/analysis-protocol.md, section 9. Changing one needs a deviation-log entry. */
export const CLAIM_GATES = { minSitesPerGroup: 4, minLowerBound: 0.8, maxShuffleP: 0.05, maxNoStructureResolved: 0.05, minFragmentResolved: 0.95, fragmentLengths: [100, 150, 200, 300, 400, 500], fragmentPositions: 5 } as const

export const DEFAULT_CONTROLS = { shuffles: 99, simulations: 20, seed: 20261105 } as const

function binomialTail(k: number, n: number, p: number): number {
  // P(X >= k), in logs so large n can't overflow.
  if (k <= 0) return 1
  if (p <= 0) return 0
  if (p >= 1) return 1
  let logTerm = n * Math.log(1 - p)
  let sum = 0
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += Math.exp(logTerm)
    logTerm += Math.log((n - i) / (i + 1)) + Math.log(p / (1 - p))
  }
  return Math.min(1, sum)
}

/** Exact two-sided interval for x of n. Sites, not records, are the n that matters here. */
export function clopperPearson(x: number, n: number, level = 0.95): [number, number] {
  if (n <= 0) return [0, 1]
  const alpha = (1 - level) / 2
  const solve = (f: (p: number) => number) => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (f(mid) < 0) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const lower = x === 0 ? 0 : solve((p) => binomialTail(x, n, p) - alpha)
  const upper = x === n ? 1 : solve((p) => binomialTail(x + 1, n, p) - (1 - alpha))
  return [lower, upper]
}

/** A small seeded generator (mulberry32), so every control can be repeated exactly. */
function randomFrom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mask = (s: string, start: number, end: number) => '-'.repeat(start) + s.slice(start, end) + '-'.repeat(Math.max(0, s.length - end))
const columnsIn = (s: string, start: number, end: number) => { let n = 0; for (let i = start; i < end; i++) if (basesOf(s[i])) n++; return n }

export type PairTally = { tests: number; right: number; wrong: number; notResolved: number; notEvaluable: number }
const emptyTally = (): PairTally => ({ tests: 0, right: 0, wrong: 0, notResolved: 0, notEvaluable: 0 })
const addOutcome = (t: PairTally, state: string, favors: Id | undefined, truth: Id) => {
  t.tests++
  if (state === 'resolved') { if (favors === truth) t.right++; else t.wrong++ }
  else if (state === 'not_resolved') t.notResolved++
  else t.notEvaluable++
}

type Claim = { input: BuildPanelInput; a: Id; b: Id; window: PanelWindow; members: PanelMember[] }

function panelFor(claim: Claim, members: PanelMember[]) {
  const settings: PanelSettings = { ...claim.input.settings, windows: [claim.window], groups: claim.input.settings.groups.filter((g) => g.id === claim.a || g.id === claim.b) }
  return unsealedBundle({ ...claim.input, settings, members })
}

const pairOutcome = (claim: Claim, query: string, bundle: ReturnType<typeof panelFor>) => {
  const r = evaluateQuery(query, bundle, { queryId: 'q', runId: 'validation' })
  return r.pairs.find((p) => p.a === claim.a && p.b === claim.b) ?? r.pairs[0]!
}

/** Holds out each site, scoring whether the pair resolves toward the true group. */
function siteHoldOut(claim: Claim, members: PanelMember[]) {
  const sites = [...new Set(members.map((m) => m.block ?? `record:${m.record}`))]
  const perSite: { site: string; group: Id; share: number; allRight: boolean }[] = []
  const tally = emptyTally()
  const { start, end } = claim.window
  for (const site of sites) {
    const held = members.filter((m) => (m.block ?? `record:${m.record}`) === site)
    const bundle = panelFor(claim, members.filter((m) => !held.includes(m)))
    let right = 0
    for (const m of held) {
      const p = pairOutcome(claim, mask(m.aligned, start, end), bundle)
      addOutcome(tally, p.state, p.favors, m.group)
      if (p.state === 'resolved' && p.favors === m.group) right++
    }
    perSite.push({ site, group: held[0]!.group, share: right / held.length, allRight: right === held.length })
  }
  return { perSite, tally }
}

export type GateResult = { gate: 'sites' | 'no-wrong-answers' | 'interval' | 'across-studies' | 'shuffled-labels' | 'no-structure' | 'minimum-length'; passed: boolean; ran: boolean; detail: string }

export type ClaimReport = {
  a: Id
  b: Id
  window: Id
  passed: boolean
  sites: { a: number; b: number }
  records: { a: number; b: number }
  gates: GateResult[]
  /** Held-out sites where all records resolved right. */
  sitesRight?: number
  interval?: [number, number]
  studies?: { study: string; tally: PairTally }[]
  shuffleP?: number
  noStructureResolved?: number
  fragments?: { length: number; tally: PairTally }[]
  minColumns?: number
}

/** Coalescent on n tips in one population: no group or site means anything here. */
function simulateOnePopulation(root: string, n: number, theta: number, random: () => number): string[] {
  type Node = { up?: Node; branch: number; mutations: [number, string][] }
  const tips: Node[] = Array.from({ length: n }, () => ({ branch: 0, mutations: [] }))
  let alive = tips.map((node) => ({ node, age: 0 }))
  let age = 0
  while (alive.length > 1) {
    const k = alive.length
    age += -Math.log(1 - random()) / ((k * (k - 1)) / 2)
    const i = Math.floor(random() * k)
    let j = Math.floor(random() * (k - 1))
    if (j >= i) j++
    const parent: Node = { branch: 0, mutations: [] }
    for (const x of [alive[i]!, alive[j]!]) { x.node.up = parent; x.node.branch = age - x.age }
    alive = alive.filter((_, x) => x !== i && x !== j)
    alive.push({ node: parent, age })
  }
  const seen = new Set<Node>()
  for (const tip of tips) {
    for (let node: Node | undefined = tip; node?.up && !seen.has(node); node = node.up) {
      seen.add(node)
      // With time in coalescent units, pairwise differences average theta, so mutations fall at theta/2 per unit.
      let budget = (theta / 2) * node.branch
      while ((budget -= -Math.log(1 - random())) > 0) {
        const at = Math.floor(random() * root.length)
        const choices = 'ACGT'.replace(root[at]!.toUpperCase(), '')
        node.mutations.push([at, choices[Math.floor(random() * choices.length)] ?? 'A'])
      }
    }
  }
  return tips.map((tip) => {
    const out = root.split('')
    const path: Node[] = []
    for (let node: Node | undefined = tip; node; node = node.up) path.push(node)
    for (const node of path.reverse()) for (const [at, base] of node.mutations) out[at] = base
    return out.join('')
  })
}

function meanPairwiseDifferences(members: PanelMember[], window: PanelWindow): number {
  const seqs = members.map((m) => m.aligned)
  let sum = 0
  let pairs = 0
  for (let x = 0; x < seqs.length; x++) {
    for (let y = x + 1; y < seqs.length; y++) {
      let shared = 0
      let diff = 0
      for (let i = window.start; i < window.end; i++) {
        const [p, q] = [seqs[x]![i]?.toUpperCase(), seqs[y]![i]?.toUpperCase()]
        if (!p || !q || !'ACGT'.includes(p) || !'ACGT'.includes(q)) continue
        shared++
        if (p !== q) diff++
      }
      if (shared) { sum += diff / shared; pairs++ }
    }
  }
  return pairs ? (sum / pairs) * (window.end - window.start) : 0
}

function testClaim(input: BuildPanelInput, a: Id, b: Id, window: PanelWindow, controls: { shuffles: number; simulations: number; seed: number }): ClaimReport {
  const { minSharedColumns } = input.settings.rules
  const members = input.members.filter((m) => (m.group === a || m.group === b) && locates(m) && columnsIn(m.aligned, window.start, window.end) >= minSharedColumns)
  const of = (g: Id) => members.filter((m) => m.group === g)
  const siteCount = (g: Id) => new Set(of(g).flatMap((m) => (m.block ? [m.block] : []))).size
  const sites = { a: siteCount(a), b: siteCount(b) }
  const base = { a, b, window: window.id, sites, records: { a: of(a).length, b: of(b).length } }
  const gates: GateResult[] = []
  const claim: Claim = { input, a, b, window, members }
  const notRun = (...names: GateResult['gate'][]) => names.forEach((gate) => gates.push({ gate, passed: false, ran: false, detail: 'Not run, because an earlier gate failed' }))
  const enoughSites = sites.a >= CLAIM_GATES.minSitesPerGroup && sites.b >= CLAIM_GATES.minSitesPerGroup
  gates.push({ gate: 'sites', passed: enoughSites, ran: true, detail: `${sites.a} and ${sites.b} sites, and ${CLAIM_GATES.minSitesPerGroup} needed for each` })
  if (!enoughSites) {
    notRun('no-wrong-answers', 'interval', 'across-studies', 'shuffled-labels', 'no-structure', 'minimum-length')
    return { ...base, passed: false, gates }
  }

  const held = siteHoldOut(claim, members)
  gates.push({ gate: 'no-wrong-answers', passed: held.tally.wrong === 0, ran: true, detail: `${held.tally.wrong} of ${held.tally.tests} tests resolved toward the wrong group` })

  const sitesRight = held.perSite.filter((s) => s.allRight).length
  const interval = clopperPearson(sitesRight, held.perSite.length)
  gates.push({ gate: 'interval', passed: interval[0] >= CLAIM_GATES.minLowerBound, ran: true, detail: `${sitesRight} of ${held.perSite.length} sites all right, lower bound ${interval[0].toFixed(3)}, and ${CLAIM_GATES.minLowerBound} needed` })

  const names = [...new Set(members.flatMap((m) => (m.study ? [m.study] : [])))].sort()
  const studies = names.map((study) => {
    const bundle = panelFor(claim, members.filter((m) => m.study !== study))
    const tally = emptyTally()
    for (const m of members.filter((x) => x.study === study)) {
      const p = pairOutcome(claim, mask(m.aligned, window.start, window.end), bundle)
      addOutcome(tally, p.state, p.favors, m.group)
    }
    return { study, tally }
  })
  const wrongAcross = studies.reduce((n, s) => n + s.tally.wrong, 0)
  // Refusing to resolve isn't agreement. A study counts only if a panel without it actually reached an answer about it.
  const testableStudies = studies.filter((s) => s.tally.right + s.tally.wrong > 0).length
  const acrossOk = names.length >= 2 && wrongAcross === 0 && testableStudies >= 1
  gates.push({ gate: 'across-studies', passed: acrossOk, ran: true, detail: names.length < 2 ? `Only ${names.length} study` : `${wrongAcross} wrong across ${names.length} studies, with an answer reached for ${testableStudies}: ${studies.map((s) => `${s.tally.right} right, ${s.tally.notResolved} not resolved`).join('; ')}` })

  // Whole sites move between the two groups. The score weighs each site equally, so one large site can't carry it.
  const score = (perSite: { share: number }[]) => perSite.reduce((n, s) => n + s.share, 0) / perSite.length
  const real = score(held.perSite)
  const random = randomFrom(controls.seed)
  const siteIds = [...new Set(members.map((m) => m.block ?? `record:${m.record}`))]
  const originally = new Map(members.map((m) => [m.block ?? `record:${m.record}`, m.group]))
  let beaten = 0
  for (let s = 0; s < controls.shuffles; s++) {
    const labels = siteIds.map((id) => originally.get(id)!)
    for (let i = labels.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[labels[i], labels[j]] = [labels[j]!, labels[i]!]
    }
    const relabelled = new Map(siteIds.map((id, i) => [id, labels[i]!]))
    const shuffled = members.map((m) => ({ ...m, group: relabelled.get(m.block ?? `record:${m.record}`)! }))
    if (score(siteHoldOut(claim, shuffled).perSite) >= real) beaten++
  }
  const shuffleP = (beaten + 1) / (controls.shuffles + 1)
  gates.push({ gate: 'shuffled-labels', passed: shuffleP <= CLAIM_GATES.maxShuffleP, ran: true, detail: `Real score ${real.toFixed(3)}, equaled or beaten by ${beaten} of ${controls.shuffles} shuffles, p = ${shuffleP.toFixed(3)}` })

  const root = input.referenceSequence ?? members[0]!.aligned.replace(/[^ACGTacgt]/g, 'A')
  const theta = meanPairwiseDifferences(members, window)
  const sim = emptyTally()
  for (let s = 0; s < controls.simulations; s++) {
    const seqs = simulateOnePopulation(root, members.length, theta, randomFrom(controls.seed + 1 + s))
    const simulated = members.map((m, i) => ({ ...m, aligned: [...seqs[i]!].map((c, k) => (basesOf(m.aligned[k]) ? c : '-')).join('') }))
    const { tally } = siteHoldOut(claim, simulated)
    for (const k of Object.keys(sim) as (keyof PairTally)[]) sim[k] += tally[k]
  }
  const noStructureResolved = sim.tests ? (sim.right + sim.wrong) / sim.tests : 0
  gates.push({ gate: 'no-structure', passed: noStructureResolved <= CLAIM_GATES.maxNoStructureResolved, ran: true, detail: `${sim.right + sim.wrong} of ${sim.tests} simulated tests resolved the pair (${sim.right} right, ${sim.wrong} wrong), and at most ${CLAIM_GATES.maxNoStructureResolved} allowed` })

  const fragments = fragmentLadder(claim, members, controls.seed)
  const qualifying = fragments.find((f) => f.tally.tests > 0 && f.tally.wrong === 0 && f.tally.right / f.tally.tests >= CLAIM_GATES.minFragmentResolved)
  gates.push({ gate: 'minimum-length', passed: Boolean(qualifying), ran: true, detail: qualifying ? `Shortest qualifying length is ${qualifying.length} columns` : 'No fragment length qualified' })

  return {
    ...base, passed: gates.every((g) => g.passed), gates, sitesRight, interval, studies, shuffleP, noStructureResolved, fragments,
    ...(qualifying ? { minColumns: qualifying.length } : {}),
  }
}

function fragmentLadder(claim: Claim, members: PanelMember[], seed: number) {
  const random = randomFrom(seed ^ 0x5eed)
  const { start: wStart, end: wEnd } = claim.window
  const out = CLAIM_GATES.fragmentLengths.map((length) => ({ length, tally: emptyTally() }))
  for (const site of new Set(members.map((m) => m.block ?? `record:${m.record}`))) {
    const held = members.filter((m) => (m.block ?? `record:${m.record}`) === site)
    const bundle = panelFor(claim, members.filter((m) => !held.includes(m)))
    for (const m of held) {
      let first = wEnd
      let last = wStart
      for (let i = wStart; i < wEnd; i++) if (basesOf(m.aligned[i])) { if (i < first) first = i; last = i + 1 }
      for (const row of out) {
        if (last - first < row.length) continue
        for (let k = 0; k < CLAIM_GATES.fragmentPositions; k++) {
          const at = first + Math.floor(random() * (last - first - row.length + 1))
          const p = pairOutcome(claim, mask(m.aligned, at, at + row.length), bundle)
          addOutcome(row.tally, p.state, p.favors, m.group)
        }
      }
    }
  }
  return out
}

/** Only claims that passed, all still exploratory: passing means surviving controls on data that shaped the method. */
export function validatedScopeFromReport(claims: ClaimReport[]): ValidatedClaim[] {
  return claims.filter((c) => c.passed).map((c) => ({ a: c.a, b: c.b, window: c.window, minColumns: c.minColumns!, sites: c.sites, basis: 'exploratory' as const }))
}

export const describeClaim = (c: ValidatedClaim) => `${c.a} vs ${c.b} in ${c.window}, ${c.minColumns}+ columns (${c.basis}; ${c.sites.a} and ${c.sites.b} sites)`

export type FullValidation = {
  blocks: ValidationReport
  groups: ValidationReport
  /** Side by side and never averaged. The record scheme is only a leak detector. */
  ladder: ValidationReport[]
  claims: ClaimReport[]
  controls: { shuffles: number; simulations: number; seed: number }
}

/** Runs the whole ladder and tests every pair of groups in every window. Slow: it rebuilds a panel for every held-out site in every control. */
export function fullValidation(input: ValidationInput): FullValidation {
  const controls = { ...DEFAULT_CONTROLS, ...input.settings.controls }
  const windows = input.settings.windows?.length ? input.settings.windows : wholeMarker(input.reference.length)
  const ids = input.settings.groups.map((g) => g.id)
  const claims: ClaimReport[] = []
  for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) for (const w of windows) claims.push(testClaim(input, ids[x]!, ids[y]!, w, controls))
  const blocks = leaveOneBlockOut(input)
  const ladder = [
    holdOut(input, (m) => `record:${m.record}`, 'leave-one-record-out'),
    holdOut(input, (m) => m.aligned.toUpperCase(), 'leave-one-haplotype-out'),
    blocks,
    holdOut(input, (m) => m.study ?? `record:${m.record}`, 'leave-one-study-out'),
  ]
  return { blocks, groups: leaveOneGroupOut(input), ladder, claims, controls }
}
