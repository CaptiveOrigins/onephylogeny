import { compatibility } from '@extantape/onephylogeny-core'
import type { Individual, PedigreeDocument } from '@extantape/onepedigree-core'

export type LineConflict = {
  /** The recorded mother and offspring whose sequences can't be the same maternal haplotype. */
  mother: string
  offspring: string
  message: string
}

export type MaternalLineReport = {
  conflicts: LineConflict[]
  /** Pairs with too little shared sequence to say anything. */
  notEvaluable: { mother: string; offspring: string }[]
  checked: number
}

const MATERNAL_ROLES = new Set(['mother', 'dam', 'egg'])

const mothersOf = (individual: Individual): string[] =>
  (individual.parentage?.parents ?? []).filter((p) => MATERNAL_ROLES.has(String(p.role))).map((p) => p.individual)

/**
 * Mitochondrial sequence is generally inherited from the mother, so a recorded mother and offspring should be
 * compatible. A conflict is something to review: the record, the sample or a real mutation could explain it, so
 * neither the pedigree nor the sequence is ever changed. Agreement doesn't verify parentage, because unrelated
 * animals can share a haplotype.
 */
export function checkMaternalLines(pedigree: PedigreeDocument, alignedByIndividual: Record<string, string>, options: { minOverlap?: number } = {}): MaternalLineReport {
  const minOverlap = options.minOverlap ?? 100
  const report: MaternalLineReport = { conflicts: [], notEvaluable: [], checked: 0 }
  for (const individual of pedigree.individuals) {
    const own = alignedByIndividual[individual.id]
    if (!own) continue
    for (const mother of mothersOf(individual)) {
      const hers = alignedByIndividual[mother]
      if (!hers) continue
      report.checked++
      const c = compatibility(own, hers, minOverlap)
      if (c === 'not-evaluable') report.notEvaluable.push({ mother, offspring: individual.id })
      if (c === 'conflict') report.conflicts.push({ mother, offspring: individual.id, message: `${individual.id} and recorded mother ${mother} differ, so check the record, the samples or a possible mutation` })
    }
  }
  return report
}
