import { basesOf } from './sequence.js'

/** A nuclear copy of the marker found by the screen, in reference columns, sealed into a panel. */
export type NumtCopy = { id: string; aligned: string }
export const NUMT_MIN_SHARED_COLUMNS = 100

export type NumtCheck = { tested: number; flagged: { copy: string; shared: number; toCopy: number; toReference: number }[] }

/** Differences per compared column, where both have one plain base. Ambiguous bases are skipped, as in the screen. */
function compare(a: string, b: string, only: (i: number) => boolean = () => true) {
  let shared = 0
  let differences = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (!only(i)) continue
    const x = basesOf(a[i])
    const y = basesOf(b[i])
    if (!x || !y || x.length !== 1 || y.length !== 1) continue
    shared++
    if (x[0] !== y[0]) differences++
  }
  return { shared, distance: shared ? differences / shared : 0 }
}

/**
 * The flag rule from the NUMT screen (analysis protocol, section 7): strictly closer to a copy than to the reference, on the same
 * columns, where they share enough. A flag sends a sequence to review and doesn't prove a NUMT. No flag clears nothing, since a
 * copy that arose after two species split can't be in another species' genome.
 */
export function checkNumts(aligned: string, copies: NumtCopy[], reference: string): NumtCheck {
  const out: NumtCheck = { tested: 0, flagged: [] }
  for (const copy of copies) {
    const toCopy = compare(aligned, copy.aligned)
    if (toCopy.shared < NUMT_MIN_SHARED_COLUMNS) continue
    out.tested++
    const toReference = compare(aligned, reference, (i) => basesOf(copy.aligned[i])?.length === 1)
    if (toCopy.distance < toReference.distance) out.flagged.push({ copy: copy.id, shared: toCopy.shared, toCopy: toCopy.distance, toReference: toReference.distance })
  }
  return out
}
