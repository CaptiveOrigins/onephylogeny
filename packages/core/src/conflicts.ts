import type { Id, Result } from './model.js'

/**
 * Conflict reporting (roadmap stage 4): when the evidence in one result points more than one way. A conflict doesn't
 * change any status; it is reported beside them, so a reader sees that the answer is less tidy than a single label.
 */
export type ResultConflict =
  /** More than one group is consistent with the sequence. */
  | { kind: 'several-groups-consistent'; groups: Id[] }
  /** In different windows, different groups are closest. Fragments of one amplicon can't show this; whole genes can. */
  | { kind: 'windows-disagree'; windows: { window: Id; closest: Id[] }[] }
  /** A comparison favours a group the result rules out, or goes against the one group that fits. */
  | { kind: 'comparisons-disagree'; group: Id; against: Id[] }

export function resultConflicts(result: Result): ResultConflict[] {
  const out: ResultConflict[] = []
  const consistent = result.findings.filter((f) => f.status === 'consistent').map((f) => f.group)
  if (consistent.length > 1) out.push({ kind: 'several-groups-consistent', groups: [...consistent].sort() })

  // Per window, the groups nearest by differences per shared column.
  const byWindow = new Map<Id, { group: Id; rate: number }[]>()
  for (const f of result.findings) for (const w of f.windows) if (w.sharedColumns > 0) byWindow.set(w.window, [...(byWindow.get(w.window) ?? []), { group: f.group, rate: w.differences / w.sharedColumns }])
  const closest = [...byWindow].map(([window, gs]) => {
    const best = Math.min(...gs.map((g) => g.rate))
    return { window, closest: gs.filter((g) => g.rate === best).map((g) => g.group).sort() }
  }).sort((a, b) => String(a.window).localeCompare(String(b.window)))
  const disjoint = closest.some((a, i) => closest.slice(i + 1).some((b) => !a.closest.some((g) => b.closest.includes(g))))
  if (closest.length > 1 && disjoint) out.push({ kind: 'windows-disagree', windows: closest })

  const excluded = new Set(result.findings.filter((f) => f.status === 'excluded_within_panel').map((f) => f.group))
  const fits = consistent.length === 1 ? consistent[0] : undefined
  const against = new Map<Id, Id[]>()
  for (const p of result.pairs) {
    if (p.state !== 'resolved' || !p.favors) continue
    const loser = p.favors === p.a ? p.b : p.a
    if (excluded.has(p.favors)) against.set(p.favors, [...(against.get(p.favors) ?? []), loser])
    if (fits !== undefined && loser === fits) against.set(fits, [...(against.get(fits) ?? []), p.favors])
  }
  for (const [group, others] of [...against].sort(([a], [b]) => String(a).localeCompare(String(b)))) out.push({ kind: 'comparisons-disagree', group, against: [...new Set(others)].sort() })
  return out
}

export function conflictText(c: ResultConflict, label: (id: Id) => string = String): string {
  if (c.kind === 'several-groups-consistent') return `More than one group fits this sequence: ${c.groups.map(label).join(', ')}.`
  if (c.kind === 'windows-disagree') return `Different parts of the gene point to different groups: ${c.windows.map((w) => `${w.window} is closest to ${w.closest.map(label).join(' and ')}`).join('; ')}.`
  return `Comparisons disagree about ${label(c.group)}: it is set against ${c.against.map(label).join(', ')} in a way its own status doesn't support.`
}
