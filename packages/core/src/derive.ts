import { basesOf, compareAligned } from './sequence.js'
import type { EvaluationRules, GroupCoverage, PanelPair, PanelWindow, PairSite } from './model.js'

/** Starting values from the techniques research, written before this code existed. Uncalibrated. */
export const DEFAULT_RULES: EvaluationRules = { minSharedColumns: 100, minDepthPerColumn: 5, minBlocksForExclusion: 3, minDecisiveSites: 2, tolerance: 1 }

export const wholeMarker = (length: number): PanelWindow[] => [{ id: 'whole', label: 'Whole marker', start: 0, end: length }]

export type DeriveRecord = { aligned: string; block?: string | undefined }
export type DeriveInput = { length: number; windows: PanelWindow[]; rules: EvaluationRules; groups: { id: string; records: DeriveRecord[] }[] }
export type Derived = { coverage: Record<string, GroupCoverage[]>; pairs: PanelPair[] }

/** Records with no site all share this block, so missing data can't pass for independent sites. */
const UNSITED = '\u0000unsited'
const blockOf = (r: DeriveRecord) => r.block ?? UNSITED

type Column = { depth: number; states: string; blocks: Set<string> }

function columnsOf(records: DeriveRecord[], length: number): Column[] {
  const out: Column[] = Array.from({ length }, () => ({ depth: 0, states: '', blocks: new Set<string>() }))
  for (const r of records) {
    for (let i = 0; i < length; i++) {
      const possible = basesOf(r.aligned[i])
      if (!possible) continue
      const c = out[i]!
      c.depth++
      c.blocks.add(blockOf(r))
      // An ambiguity code adds every base it could be, so a compatible one breaks fixedness.
      for (const b of possible) if (!c.states.includes(b)) c.states += b
    }
  }
  return out
}

/** The largest rate from any distinct sequence to its nearest groupmate in this window. */
function spreadRate(records: DeriveRecord[], window: PanelWindow, minShared: number): number | null {
  const slices = [...new Set(records.map((r) => r.aligned.slice(window.start, window.end).toUpperCase()))]
  let spread: number | null = null
  for (const a of slices) {
    let nearest = Infinity
    for (const b of slices) {
      if (a === b) continue
      const c = compareAligned(a, b)
      if (c.overlap >= minShared && c.pDistance !== null && c.pDistance < nearest) nearest = c.pDistance
    }
    if (nearest !== Infinity && (spread === null || nearest > spread)) spread = nearest
  }
  return spread
}

const sorted = (s: string) => [...s].sort().join('')
const unseen = (n: number) => Math.round((1 - 0.05 ** (1 / n)) * 10000) / 10000

/**
 * Coverage per group and sites per pair, from the sequences and rules alone. Panels store this because it's the readable
 * output, and loading derives it again, so a stored value can never disagree with the data behind it.
 */
export function deriveEvaluation({ length, windows, rules, groups }: DeriveInput): Derived {
  const columns = new Map(groups.map((g) => [g.id, columnsOf(g.records, length)]))
  const coverage: Record<string, GroupCoverage[]> = {}
  for (const g of groups) {
    const cols = columns.get(g.id)!
    coverage[g.id] = windows.map((w) => {
      const present = g.records.filter((r) => { for (let i = w.start; i < w.end; i++) if (basesOf(r.aligned[i])) return true; return false })
      const runs: [number, number][] = []
      let start = -1
      let best = 0
      for (let i = w.start; i <= w.end; i++) {
        const depth = i < w.end ? cols[i]!.depth : 0
        if (depth > best) best = depth
        const deep = i < w.end && depth >= rules.minDepthPerColumn
        if (deep && start < 0) start = i
        if (!deep && start >= 0) { runs.push([start, i]); start = -1 }
      }
      return {
        window: w.id, records: present.length, blocks: new Set(present.map(blockOf)).size, columnsAtDepth: runs,
        spreadRate: spreadRate(present, w, rules.minSharedColumns), recordsNeeded: Math.max(0, rules.minDepthPerColumn - best),
      }
    })
  }
  const pairs: PanelPair[] = []
  for (let x = 0; x < groups.length; x++) {
    for (let y = x + 1; y < groups.length; y++) {
      const [a, b] = [groups[x]!, groups[y]!]
      const [ca, cb] = [columns.get(a.id)!, columns.get(b.id)!]
      windows.forEach((w, wi) => {
        const [wa, wb] = [coverage[a.id]![wi]!, coverage[b.id]![wi]!]
        const base = { a: a.id, b: b.id, window: w.id, records: { a: wa.records, b: wb.records }, blocks: { a: wa.blocks, b: wb.blocks } }
        const columnsAtDepth = (c: GroupCoverage) => c.columnsAtDepth.reduce((n, [s, e]) => n + e - s, 0)
        const thin = [wa, wb].filter((c) => columnsAtDepth(c) < rules.minSharedColumns)
        if (thin.length) {
          const names = [wa === thin[0] || wa === thin[1] ? a.id : null, wb === thin[0] || wb === thin[1] ? b.id : null].filter(Boolean).join(' and ')
          pairs.push({ ...base, state: 'not_evaluable', reason: `${names} lacks ${rules.minSharedColumns} columns with ${rules.minDepthPerColumn} records in this window`, sites: [] })
          return
        }
        const sites: PairSite[] = []
        for (let p = w.start; p < w.end; p++) {
          const [l, r] = [ca[p]!, cb[p]!]
          if (l.depth < rules.minDepthPerColumn || r.depth < rules.minDepthPerColumn) continue
          if ([...l.states].some((s) => r.states.includes(s))) continue
          sites.push({ position: p, a: sorted(l.states), b: sorted(r.states), depth: { a: l.depth, b: r.depth }, blocks: { a: l.blocks.size, b: r.blocks.size }, unseenUpper95: { a: unseen(l.depth), b: unseen(r.depth) } })
        }
        pairs.push({ ...base, state: sites.length ? 'resolvable' : 'no_fixed_sites', sites })
      })
    }
  }
  return { coverage, pairs }
}
