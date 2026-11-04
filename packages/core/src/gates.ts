import type { Alignment } from './align.js'
import type { Diagnostic, GeneticCode } from './model.js'
import { internalStops } from './sequence.js'

export type GateSettings = { minAlignedColumns: number; minIdentity: number; codonStart?: number; geneticCode?: GeneticCode }

export const DEFAULT_GATES: GateSettings = { minAlignedColumns: 100, minIdentity: 0.75 }

const translateFrame = (aligned: string, codonStart: number, code: GeneticCode): number[] => {
  const stops: number[] = []
  let last = aligned.length
  while (last > 0 && aligned[last - 1] === '-') last--
  for (let i = codonStart; i + 3 < last; i += 3) {
    const codon = aligned.slice(i, i + 3)
    if (/[^ACGT]/.test(codon)) continue
    if (internalStops(`${codon}AAAAAA`, 0, code).length) stops.push(i)
  }
  return stops
}

/** Decides whether an aligned record can be used, and says why not. Errors exclude the record; warnings keep it visible. */
export function assessAlignment(alignment: Alignment | null, settings: GateSettings): Diagnostic[] {
  if (!alignment) return [{ severity: 'error', code: 'no-reference-match', message: 'Shares no seed with the reference, in either orientation: probably a different gene' }]
  const out: Diagnostic[] = []
  const columns = alignment.matches + alignment.mismatches
  if (columns < settings.minAlignedColumns) out.push({ severity: 'error', code: 'too-few-aligned-columns', message: `Only ${columns} columns align to the reference (minimum ${settings.minAlignedColumns}): probably a different gene or a poor fragment` })
  if (alignment.identity < settings.minIdentity) out.push({ severity: 'error', code: 'low-identity', message: `Identity to the reference is ${(alignment.identity * 100).toFixed(1)}% (minimum ${(settings.minIdentity * 100).toFixed(0)}%)` })
  const indels = [...alignment.insertions, ...alignment.deletions]
  if (indels.some((x) => x.length % 3 !== 0)) out.push({ severity: 'warning', code: 'frame-shifting-indel', message: `Has insertions or deletions that aren't multiples of three: ${JSON.stringify({ insertions: alignment.insertions, deletions: alignment.deletions })}` })
  if (settings.geneticCode && settings.codonStart !== undefined) {
    const stops = translateFrame(alignment.aligned, settings.codonStart, settings.geneticCode)
    if (stops.length) out.push({ severity: 'warning', code: 'internal-stop', message: `In-frame stop codons at reference columns ${stops.slice(0, 5).join(', ')}: possible pseudogene (NUMT) or sequencing error` })
  }
  if (alignment.orientation === 'reverse') out.push({ severity: 'info', code: 'reverse-complemented', message: 'Stored on the opposite strand, and reverse-complemented to match the reference' })
  return out
}
