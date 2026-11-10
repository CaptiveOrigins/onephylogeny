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

/** A panel record whose windows point to different groups: a possible chimera, or two reads joined from different animals. */
export type ChimeraCandidate = { record: Id; group: Id; windows: { window: Id; nearestGroups: Id[]; distance: number }[] }

/** The majority base per column, ties broken alphabetically, so one odd record can't decide a group's consensus. */
function consensus(slices: string[]): string {
  if (!slices.length) return ''
  let out = ''
  for (let i = 0; i < slices[0]!.length; i++) {
    const n = new Map<string, number>()
    for (const s of slices) if (BASES.has(s[i]!)) n.set(s[i]!, (n.get(s[i]!) ?? 0) + 1)
    out += [...n].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0] ?? 'N'
  }
  return out
}

/**
 * Authenticity check (roadmap stage 4): for every record that covers at least two windows whole (the same strict rule as
 * the group audit, ADR 0007), the group whose consensus it is nearest in each window. Consensus leaves the record itself
 * out, so one odd record can't pull its neighbours with it. When two windows' nearest groups share none, the record is a
 * candidate chimera, for a person to look at. Nothing is removed automatically.
 */
export function chimeraCandidates(bundle: PanelBundle): { candidates: ChimeraCandidate[]; checked: number } {
  const { panel, sequences } = bundle
  const groupOf = new Map<Id, Id>()
  for (const g of panel.groups) for (const e of g.evidence) if (!groupOf.has(e.record)) groupOf.set(e.record, g.id)
  const whole = (s: string | undefined, w: { start: number; end: number }) => {
    if (!s) return null
    const slice = s.slice(w.start, w.end)
    return slice.length === w.end - w.start && !/[-.]/.test(slice) ? slice.toUpperCase() : null
  }
  const records = [...groupOf].sort(([a], [b]) => String(a).localeCompare(String(b)))
  const candidates: ChimeraCandidate[] = []
  let checked = 0
  for (const [record, group] of records) {
    const windows = panel.windows.map((w) => ({ w, slice: whole(sequences[record], w) })).filter((x): x is { w: typeof x.w; slice: string } => x.slice !== null)
    if (windows.length < 2) continue
    checked++
    const near = windows.map(({ w, slice }) => {
      let best = Infinity
      let groups: Id[] = []
      for (const g of panel.groups) {
        const others = records.filter(([r, rg]) => rg === g.id && r !== record).map(([r]) => whole(sequences[r], w)).filter((x): x is string => x !== null)
        if (!others.length) continue
        const d = pDistance(slice, consensus(others))
        if (d < best) { best = d; groups = [g.id] } else if (d === best) groups.push(g.id)
      }
      // A window where the record's own group has nothing to compare can't show a mismatch.
      const own = records.some(([r, rg]) => rg === group && r !== record && whole(sequences[r], w) !== null)
      return { window: w.id, nearestGroups: own ? groups.sort() : [], distance: round(best) }
    }).filter((x) => x.nearestGroups.length)
    const disjoint = near.some((a, i) => near.slice(i + 1).some((b) => !a.nearestGroups.some((g) => b.nearestGroups.includes(g))))
    if (disjoint) candidates.push({ record, group, windows: near })
  }
  return { candidates, checked }
}
