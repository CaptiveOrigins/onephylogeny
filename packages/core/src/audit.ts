import type { PanelBundle } from './build.js'
import type { Id } from './model.js'

/**
 * Group audit (roadmap stage 3): checks a panel's proposed groups against the sequences themselves, one window at a
 * time, using only records that cover the whole window, so fragments of different amplicons can't look like clusters.
 * It flags; it never assigns. Clusters don't define groups, because on fragmented data they may just recover amplicons.
 */
export type AuditFlag =
  /** Closer to a record of another group than to any record of its own. */
  | { kind: 'closer-to-other-group'; record: Id; group: Id; nearestOwn: number; nearestOther: number; otherGroup: Id; otherRecord: Id }
  /** The same haplotype in two groups: no sequence in this window can tell them apart there. */
  | { kind: 'shared-haplotype'; groups: Id[]; records: Id[] }
  /** Only one full-window record, so nothing can be said about the group's spread here. */
  | { kind: 'single-record'; group: Id; record: Id }

export type WindowAudit = {
  window: Id
  /** Records covering the whole window, per group. */
  groups: { group: Id; records: number; haplotypes: number; maxWithin: number | null }[]
  /** Records left out because they don't cover the whole window. */
  partial: number
  /** Columns the window spans, and the most any one record covers, so a window nobody covers whole is explained. */
  columns: number
  mostCovered: number
  flags: AuditFlag[]
}

const BASES = new Set(['A', 'C', 'G', 'T'])

/** Differences per compared column, over columns where both have an unambiguous base. */
export function pDistance(a: string, b: string): number {
  let compared = 0
  let differ = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!.toUpperCase()
    const y = b[i]!.toUpperCase()
    if (!BASES.has(x) || !BASES.has(y)) continue
    compared++
    if (x !== y) differ++
  }
  return compared ? differ / compared : 0
}

const round = (x: number) => Math.round(x * 1e6) / 1e6

export function auditGroups(bundle: PanelBundle): WindowAudit[] {
  const { panel, sequences } = bundle
  const groupOf = new Map<Id, Id>()
  for (const g of panel.groups) for (const e of g.evidence) if (!groupOf.has(e.record)) groupOf.set(e.record, g.id)
  return panel.windows.map((w) => {
    const full: { record: Id; group: Id; slice: string }[] = []
    let partial = 0
    let mostCovered = 0
    for (const [record, group] of groupOf) {
      const s = sequences[record]
      if (!s) continue
      const slice = s.slice(w.start, w.end)
      mostCovered = Math.max(mostCovered, slice.replace(/[-.]/g, '').length)
      if (slice.length === w.end - w.start && !/[-.]/.test(slice)) full.push({ record, group, slice: slice.toUpperCase() })
      else partial++
    }
    full.sort((a, b) => String(a.record).localeCompare(String(b.record)))
    const flags: AuditFlag[] = []
    // Identical haplotypes across groups.
    const byHap = new Map<string, typeof full>()
    for (const r of full) byHap.set(r.slice, [...(byHap.get(r.slice) ?? []), r])
    for (const rs of byHap.values()) {
      const gs = [...new Set(rs.map((r) => r.group))].sort()
      if (gs.length > 1) flags.push({ kind: 'shared-haplotype', groups: gs, records: rs.map((r) => r.record) })
    }
    const groups = panel.groups.map((g) => {
      const own = full.filter((r) => r.group === g.id)
      let maxWithin: number | null = own.length > 1 ? 0 : null
      for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) maxWithin = Math.max(maxWithin!, pDistance(own[i]!.slice, own[j]!.slice))
      if (own.length === 1) flags.push({ kind: 'single-record', group: g.id, record: own[0]!.record })
      return { group: g.id, records: own.length, haplotypes: new Set(own.map((r) => r.slice)).size, maxWithin: maxWithin === null ? null : round(maxWithin) }
    })
    for (const r of full) {
      let nearestOwn = Infinity
      let nearestOther = Infinity
      let other: (typeof full)[number] | undefined
      for (const s of full) {
        if (s === r) continue
        const d = pDistance(r.slice, s.slice)
        if (s.group === r.group) nearestOwn = Math.min(nearestOwn, d)
        else if (d < nearestOther) { nearestOther = d; other = s }
      }
      // A single-record group has no own neighbour; that's flagged above, not as a misfit.
      if (other && nearestOwn !== Infinity && nearestOther < nearestOwn)
        flags.push({ kind: 'closer-to-other-group', record: r.record, group: r.group, nearestOwn: round(nearestOwn), nearestOther: round(nearestOther), otherGroup: other.group, otherRecord: other.record })
    }
    return { window: w.id, groups, partial, columns: w.end - w.start, mostCovered, flags }
  })
}
