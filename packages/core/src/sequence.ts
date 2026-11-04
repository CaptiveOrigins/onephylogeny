import type { GeneticCode } from './model.js'

/** The bases each IUPAC code may stand for. Gaps and N carry no information here. */
const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG',
}

export const isMissing = (c: string | undefined) => c === undefined || !(c in IUPAC)

export type Window = { start: number; end: number }

export type Comparison = {
  /** Columns where both sequences have information. */
  overlap: number
  /** Overlapping columns that cannot be the same base. */
  differences: number
  /** Overlapping columns where an ambiguity code could match or differ. */
  unresolved: number
  /** differences / overlap, or null with no overlap: no shared sites means no measurement, not zero. */
  pDistance: number | null
}

/** Compares two sequences aligned to the same reference coordinates. Missing data is never a difference. */
export function compareAligned(a: string, b: string, window?: Window): Comparison {
  if (a.length !== b.length) throw new Error(`Aligned sequences differ in length (${a.length} and ${b.length}); they are not in one coordinate system`)
  const start = window?.start ?? 0
  const end = window?.end ?? a.length
  let overlap = 0
  let differences = 0
  let unresolved = 0
  for (let i = start; i < end; i++) {
    const x = IUPAC[(a[i] ?? '').toUpperCase()]
    const y = IUPAC[(b[i] ?? '').toUpperCase()]
    if (!x || !y) continue
    overlap++
    if (x.length === 1 && y.length === 1) {
      if (x !== y) differences++
    } else if ([...x].some((base) => y.includes(base))) unresolved++
    else differences++
  }
  return { overlap, differences, unresolved, pDistance: overlap ? differences / overlap : null }
}

/** First and last reference columns holding information, plus how many do. Null if none. */
export function coverage(aligned: string): (Window & { bases: number }) | null {
  let first = -1
  let last = -1
  let bases = 0
  for (let i = 0; i < aligned.length; i++) {
    if (isMissing(aligned[i]?.toUpperCase())) continue
    if (first < 0) first = i
    last = i
    bases++
  }
  return first < 0 ? null : { start: first, end: last + 1, bases }
}

export function reverseComplement(seq: string): string {
  const map: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', U: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N', '-': '-' }
  let out = ''
  for (let i = seq.length - 1; i >= 0; i--) out += map[seq[i]!.toUpperCase()] ?? 'N'
  return out
}

const BASES = 'TCAG'
const STANDARD = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'
/** NCBI translation table 2 differs from table 1 at AGA, AGG, ATA and TGA. */
const VERTEBRATE_MT = 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG'

/**
 * In-frame stop codons, skipping the final codon. `frameStart` is 0-based and `gaps` are removed
 * first, so an internal deletion shows up as stops rather than disappearing.
 */
export function internalStops(seq: string, frameStart: number, code: GeneticCode): number[] {
  const table = code === 2 ? VERTEBRATE_MT : STANDARD
  const clean = seq.toUpperCase().replace(/-/g, '')
  const stops: number[] = []
  const lastCodon = frameStart + Math.floor((clean.length - frameStart) / 3) * 3 - 3
  for (let i = frameStart; i < lastCodon; i += 3) {
    const [a, b, c] = [BASES.indexOf(clean[i]!), BASES.indexOf(clean[i + 1]!), BASES.indexOf(clean[i + 2]!)]
    if (a < 0 || b < 0 || c < 0) continue
    if (table[a * 16 + b * 4 + c] === '*') stops.push(i)
  }
  return stops
}
