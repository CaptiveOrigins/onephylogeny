import { basesOf, compareAligned } from './sequence.js'
import { locates, unsealedBundle, type PanelBundle, type ValidationInput } from './build.js'
import type { Id, PanelWindow } from './model.js'

/**
 * The distance-based novelty test, as the analysis protocol (section 8, "Distance-based novelty") states it. Committed
 * 2026-11-11 before it ran on any data, and uncalibrated: nobody has yet checked how often a query from a lineage the
 * panel lacks comes out `possibly-novel`, or how often one from a sampled group does. So it changes no status and never
 * sets `result.novelty.flagged`. Anything that shows it must say it's uncalibrated.
 */
export const DISTANCE_NOVELTY_RULE = {
  /** Version of the stated rule. A change to anything here is a new version and goes in the deviation log. */
  version: 1,
  /** The within-group distance this percentile of the panel's own reaches is the most a query may sit from its nearest record. */
  percentile: 0.95,
  /** Below this many within-group distances in a window, the percentile is too close to the largest one to mean anything. */
  minReferenceDistances: 20,
} as const

export type DistanceNoveltyStatus = 'possibly-novel' | 'within-range' | 'not-evaluable'

/** The overall answer can also be that windows disagree, which is reported as such rather than settled either way. */
export type DistanceNoveltyOverall = DistanceNoveltyStatus | 'windows-disagree'

export type DistanceNoveltyReason =
  | 'beyond-threshold'
  | 'within-threshold'
  | 'too-few-query-columns'
  | 'no-record-shares-enough-columns'
  | 'too-few-reference-distances'

/** Where a window's threshold came from, so a reader can check it. */
export type NoveltyThreshold = {
  /** Differences per shared column. */
  value: number
  percentile: number
  /** Within-group nearest-groupmate distances the percentile was taken over. */
  distances: number
  /** Groups those distances came from. */
  groups: number
  method: 'leave-one-site-out-nearest-groupmate'
}

export type DistanceNoveltyWindow = {
  window: Id
  status: DistanceNoveltyStatus
  reasonCode: DistanceNoveltyReason
  reason: string
  /** Columns in this window where the query has a base. */
  queryColumns: number
  /** The panel record nearest the query here, whatever its group, when one shares enough columns. */
  nearest?: { distance: number; differences: number; overlap: number; records: Id[]; groups: Id[] }
  /** Absent when the panel has too few within-group distances here; the count it had is then in `referenceDistances`. */
  threshold?: NoveltyThreshold
  referenceDistances: number
}

export type DistanceNovelty = {
  rule: 'nearest-record-beyond-within-group-p95'
  ruleVersion: number
  /** Always false until a calibration run meeting the protocol exists. */
  calibrated: false
  status: DistanceNoveltyOverall
  windows: DistanceNoveltyWindow[]
  /** Plain words for a report. Always says the test is uncalibrated. */
  note: string
}

export const UNCALIBRATED_NOTE = 'Distance-based novelty is uncalibrated: no test has yet measured how often it is right, so it changes no finding and is shown for information only'

type Usable = { record: Id; group: Id; block: string; aligned: string }

function usableRecords(bundle: PanelBundle): Usable[] {
  const out: Usable[] = []
  for (const g of bundle.panel.groups) {
    for (const e of g.evidence) {
      if (!locates(e)) continue
      const aligned = bundle.sequences[e.record]
      // Records without a site count as one site per group, as in the evaluator, so missing data can't look independent.
      if (aligned) out.push({ record: e.record, group: g.id, block: e.block ?? `no-site:${g.id}`, aligned })
    }
  }
  return out
}

const columnsIn = (s: string, w: PanelWindow) => { let n = 0; for (let i = w.start; i < w.end; i++) if (basesOf(s[i])) n++; return n }

/** Nearest-rank percentile on an ascending list: the smallest value with at least `p` of the list at or below it. */
export const nearestRank = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!

/**
 * The panel's own within-group distances in one window: for each record, the distance to its nearest groupmate from a
 * different site, sharing at least `minSharedColumns` columns. Holding out the whole site mirrors the default claim,
 * a new site in a sampled region, and keeps duplicates from one site from pulling the threshold to zero.
 */
export function withinGroupDistances(bundle: PanelBundle, window: PanelWindow): { distances: number[]; groups: number } {
  const { minSharedColumns } = bundle.panel.rules
  const records = usableRecords(bundle)
  const distances: number[] = []
  const groups = new Set<Id>()
  for (const r of records) {
    let nearest = Infinity
    for (const o of records) {
      if (o.group !== r.group || o.block === r.block) continue
      const c = compareAligned(r.aligned, o.aligned, window)
      if (c.overlap >= minSharedColumns && c.pDistance !== null && c.pDistance < nearest) nearest = c.pDistance
    }
    if (nearest !== Infinity) { distances.push(nearest); groups.add(r.group) }
  }
  return { distances: distances.sort((a, b) => a - b), groups: groups.size }
}

// A panel's own distances don't depend on the query, so they're worked out once per bundle and window.
const cache = new WeakMap<PanelBundle, Map<Id, { distances: number[]; groups: number }>>()
function referenceFor(bundle: PanelBundle, window: PanelWindow) {
  let byWindow = cache.get(bundle)
  if (!byWindow) { byWindow = new Map(); cache.set(bundle, byWindow) }
  let ref = byWindow.get(window.id)
  if (!ref) { ref = withinGroupDistances(bundle, window); byWindow.set(window.id, ref) }
  return ref
}

const pct = (x: number) => `${(Math.round(x * 10000) / 100).toString()}%`

function windowNovelty(queryAligned: string, bundle: PanelBundle, window: PanelWindow, records: Usable[]): DistanceNoveltyWindow {
  const { minSharedColumns } = bundle.panel.rules
  const queryColumns = columnsIn(queryAligned, window)
  const base = { window: window.id, queryColumns }
  const { distances, groups } = referenceFor(bundle, window)
  const referenceDistances = distances.length
  if (queryColumns < minSharedColumns) {
    return { ...base, status: 'not-evaluable', reasonCode: 'too-few-query-columns', reason: `The sequence has ${queryColumns} columns here, below the minimum of ${minSharedColumns}`, referenceDistances }
  }
  let best: { distance: number; differences: number; overlap: number; records: Id[]; groups: Id[] } | undefined
  for (const r of records) {
    const c = compareAligned(queryAligned, r.aligned, window)
    if (c.overlap < minSharedColumns || c.pDistance === null) continue
    if (!best || c.pDistance < best.distance) best = { distance: c.pDistance, differences: c.differences, overlap: c.overlap, records: [r.record], groups: [r.group] }
    else if (c.pDistance === best.distance) {
      best.records.push(r.record)
      if (!best.groups.includes(r.group)) best.groups.push(r.group)
    }
  }
  if (!best) {
    return { ...base, status: 'not-evaluable', reasonCode: 'no-record-shares-enough-columns', reason: `No panel record shares ${minSharedColumns} columns with the sequence here`, referenceDistances }
  }
  const nearest = { ...best, records: best.records.slice(0, 5) }
  if (referenceDistances < DISTANCE_NOVELTY_RULE.minReferenceDistances) {
    return {
      ...base, status: 'not-evaluable', reasonCode: 'too-few-reference-distances', nearest, referenceDistances,
      reason: `The panel has ${referenceDistances} within-group distances here, below the ${DISTANCE_NOVELTY_RULE.minReferenceDistances} a threshold needs`,
    }
  }
  const threshold: NoveltyThreshold = { value: nearestRank(distances, DISTANCE_NOVELTY_RULE.percentile), percentile: DISTANCE_NOVELTY_RULE.percentile, distances: referenceDistances, groups, method: 'leave-one-site-out-nearest-groupmate' }
  const detail = `nearest record ${pct(best.distance)} (${best.differences} of ${best.overlap} columns); threshold ${pct(threshold.value)}, the ${threshold.percentile * 100}th percentile of ${referenceDistances} within-group distances from ${groups} groups`
  return best.distance > threshold.value
    ? { ...base, status: 'possibly-novel', reasonCode: 'beyond-threshold', reason: `Farther from every panel record than the panel's own groups usually are: ${detail}`, nearest, threshold, referenceDistances }
    : { ...base, status: 'within-range', reasonCode: 'within-threshold', reason: `Within the distance the panel's own groups show: ${detail}`, nearest, threshold, referenceDistances }
}

/**
 * Is the query farther from every panel record than the panel's groups are from themselves? Per window, then overall:
 * `possibly-novel` only if every evaluable window says so, `within-range` only if every one says that, `windows-disagree`
 * if they differ, and `not-evaluable` if none could be tested. Pure, and uncalibrated (see `DISTANCE_NOVELTY_RULE`).
 */
export function noveltyByDistance(bundle: PanelBundle, queryAligned: string): DistanceNovelty {
  const records = usableRecords(bundle)
  const windows = bundle.panel.windows.map((w) => windowNovelty(queryAligned, bundle, w, records))
  const tested = new Set(windows.filter((w) => w.status !== 'not-evaluable').map((w) => w.status))
  const status: DistanceNoveltyOverall = tested.size === 0 ? 'not-evaluable' : tested.size > 1 ? 'windows-disagree' : [...tested][0]!
  return { rule: 'nearest-record-beyond-within-group-p95', ruleVersion: DISTANCE_NOVELTY_RULE.version, calibrated: false, status, windows, note: UNCALIBRATED_NOTE }
}

export type NoveltyGroupOutRow = { group: Id; tested: number } & Record<DistanceNoveltyOverall, number>

/**
 * The group-left-out check: each whole group is removed from the panel and its records are tested. Records from a group
 * the panel lacks ought mostly to come out `possibly-novel`. These are counts from data that shaped nothing here, but
 * they are not a calibration: there's no pass mark, and one panel's groups aren't a sample of the lineages it lacks.
 */
export function noveltyGroupLeftOut(input: ValidationInput): { calibrated: false; rows: NoveltyGroupOutRow[]; totals: NoveltyGroupOutRow; note: string } {
  const empty = (group: Id): NoveltyGroupOutRow => ({ group, tested: 0, 'possibly-novel': 0, 'within-range': 0, 'windows-disagree': 0, 'not-evaluable': 0 })
  const totals = empty('all')
  const rows = input.settings.groups.map((g) => {
    const settings = { ...input.settings, groups: input.settings.groups.filter((x) => x.id !== g.id) }
    const bundle = unsealedBundle({ ...input, settings, members: input.members.filter((m) => m.group !== g.id) })
    const row = empty(g.id)
    for (const m of input.members.filter((x) => x.group === g.id && locates(x))) {
      const { status } = noveltyByDistance(bundle, m.aligned)
      row.tested++; row[status]++
      totals.tested++; totals[status]++
    }
    return row
  })
  return { calibrated: false, rows, totals, note: `${UNCALIBRATED_NOTE}. These counts are a check, not a pass or fail` }
}
