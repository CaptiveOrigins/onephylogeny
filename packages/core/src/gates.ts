import type { Alignment } from './align.js'
import type { Diagnostic, GeneticCode } from './model.js'
import { internalStops } from './sequence.js'

export type GateSettings = {
  minAlignedColumns: number
  minIdentity: number
  /** Share of the query that must align. Only records many times longer than the reference skip it: see `gatesForRecord`. */
  minQueryCoverage?: number
  /** A record with no annotated gene, at least this many times the reference's length, holds more than the marker. */
  containerRecordFactor?: number
  /** Most unaligned bases allowed at either end where the reference has columns left to align them to. */
  maxTerminalDiscordance?: number
  /** Frame-shifting indels and in-frame stops exclude the record, rather than warn. Panel builds use this. */
  frameErrors?: boolean
  codonStart?: number
  geneticCode?: GeneticCode
}

/** Starting values, not calibrated ones. See docs/architecture/analysis-protocol.md. */
export const DEFAULT_GATES: GateSettings = { minAlignedColumns: 100, minIdentity: 0.75, minQueryCoverage: 0.8, containerRecordFactor: 4, maxTerminalDiscordance: 12, frameErrors: false }

/**
 * The checks for one record. A whole mitogenome is mostly not the marker, so coverage and end checks say nothing about it.
 * Every other record gets them, including one with no annotation: an unannotated record is not a reason to trust it more.
 */
export function gatesForRecord(gates: GateSettings, record: { wholeRecord: boolean; length: number; referenceLength: number }): GateSettings {
  const factor = gates.containerRecordFactor ?? Infinity
  if (!record.wholeRecord || record.length < factor * record.referenceLength) return gates
  const { minQueryCoverage: _coverage, maxTerminalDiscordance: _ends, ...rest } = gates
  return rest
}

/** Unaligned bases at each end that had reference columns to align to. Bases beyond the reference's end are real flanks, not discordance. */
function terminalDiscordance(alignment: Alignment): { start: number; end: number } {
  const { aligned, clipped } = alignment
  let first = 0
  while (first < aligned.length && aligned[first] === '-') first++
  let last = aligned.length - 1
  while (last >= 0 && aligned[last] === '-') last--
  return { start: Math.min(clipped.start, first), end: Math.min(clipped.end, aligned.length - 1 - last) }
}

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
  const clipped = alignment.clipped.start + alignment.clipped.end
  const discordant = terminalDiscordance(alignment)
  const coverage = alignment.queryLength ? 1 - clipped / alignment.queryLength : 1
  if (settings.minQueryCoverage !== undefined && coverage < settings.minQueryCoverage) out.push({ severity: 'error', code: 'low-query-coverage', message: `Only ${(coverage * 100).toFixed(0)}% of this sequence aligns to the reference (minimum ${(settings.minQueryCoverage * 100).toFixed(0)}%): it may join other sequence, or be a different gene` })
  else if (settings.maxTerminalDiscordance !== undefined && Math.max(discordant.start, discordant.end) > settings.maxTerminalDiscordance) out.push({ severity: 'error', code: 'terminal-discordance', message: `${discordant.start} bases at the start and ${discordant.end} at the end don't match the reference, though it has columns there (maximum ${settings.maxTerminalDiscordance}): this may be joined from other sequence` })
  else if (clipped > 12) out.push({ severity: 'warning', code: 'clipped-ends', message: `${clipped} bases at the ends don't align to the reference, and were left out` })
  const indels = [...alignment.insertions, ...alignment.deletions]
  const frameSeverity = settings.frameErrors ? 'error' : 'warning'
  if (indels.some((x) => x.length % 3 !== 0)) out.push({ severity: frameSeverity, code: 'frame-shifting-indel', message: `Has insertions or deletions that aren't multiples of three: ${JSON.stringify({ insertions: alignment.insertions, deletions: alignment.deletions })}` })
  if (settings.geneticCode && settings.codonStart !== undefined) {
    const stops = translateFrame(alignment.aligned, settings.codonStart, settings.geneticCode)
    if (stops.length) out.push({ severity: frameSeverity, code: 'internal-stop', message: `In-frame stop codons at reference columns ${stops.slice(0, 5).join(', ')}: possible pseudogene (NUMT) or sequencing error` })
  }
  if (alignment.orientation === 'reverse') out.push({ severity: 'info', code: 'reverse-complemented', message: 'Stored on the opposite strand, and reverse-complemented to match the reference' })
  return out
}
