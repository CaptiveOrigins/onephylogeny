import { compareAligned, coverage } from './sequence.js'

export type Aligned = { id: string; aligned: string }

export type Haplotype = {
  id: string
  /** Same-coverage records holding exactly this sequence. A record count is not a population frequency. */
  members: string[]
  representative: string
  coverage: { start: number; end: number }
}

/**
 * Exact matches among records with the same coverage only. A shorter record never merges into a longer
 * one here: being compatible is not being identical, and compatibility is not transitive.
 */
export function collapseHaplotypes(records: Aligned[]): Haplotype[] {
  const groups = new Map<string, Aligned[]>()
  for (const r of records) {
    const c = coverage(r.aligned)
    if (!c) continue
    const key = `${c.start}:${c.end}:${r.aligned.toUpperCase()}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  return [...groups.values()].map((members, i) => {
    const c = coverage(members[0]!.aligned)!
    return {
      id: `hap-${String(i + 1).padStart(4, '0')}`,
      members: members.map((m) => m.id),
      representative: members[0]!.aligned,
      coverage: { start: c.start, end: c.end },
    }
  })
}

export type Compatibility = 'compatible' | 'conflict' | 'not-evaluable'

/** Whether two sequences could be the same haplotype over what they share. No shared sites decides nothing. */
export function compatibility(a: string, b: string, minOverlap = 1): Compatibility {
  const c = compareAligned(a, b)
  if (c.overlap < minOverlap) return 'not-evaluable'
  return c.differences > 0 ? 'conflict' : 'compatible'
}
