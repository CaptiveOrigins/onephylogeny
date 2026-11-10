/**
 * Sanger chromatograms (roadmap stage 6.3): reading ABI `.ab1` files, judging a read by its base qualities and peaks,
 * and checking which panel windows a primer pair can cover.
 *
 * Everything here describes a read. Nothing changes a base call silently: low-quality bases inside the kept region
 * become N, which the evaluator already treats as missing, and that count is reported. A file that can't be read, or
 * a read without quality values, is refused or flagged rather than guessed at.
 */
import { basesOf, reverseComplement } from './sequence.js'
import type { PanelWindow } from './model.js'

export class ChromatogramError extends Error {
  constructor(
    readonly code: 'not-abif' | 'truncated' | 'no-bases' | 'bad-entry',
    message: string,
  ) {
    super(message)
    this.name = 'ChromatogramError'
  }
}

/** One read as the sequencer called it. `quality` is null when the file has none; it is never made up. */
export type ChromatogramRead = {
  format: 'abif'
  /** The sample name typed at the sequencer (SMPL), if any. */
  sampleName: string | null
  /** The instrument model (MODL), if recorded. */
  instrument: string | null
  /** The called bases (PBAS2, or PBAS1 if there's no edited copy). */
  bases: string
  /** Phred quality per base (PCON2 or PCON1), or null. */
  quality: number[] | null
  /** Trace scan index of each base's peak (PLOC2 or PLOC1), or null. */
  peaks: number[] | null
  /** Analysed traces per base (DATA9 to DATA12, mapped through FWO_), or null. */
  traces: Record<'A' | 'C' | 'G' | 'T', Int16Array> | null
}

type Entry = { name: string; number: number; type: number; elementSize: number; count: number; size: number; offset: number; at: number }

/** Reads an ABIF (`.ab1`) file. Throws ChromatogramError for anything that isn't a readable ABIF file with base calls. */
export function readAbif(bytes: Uint8Array): ChromatogramRead {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n))
  if (bytes.byteLength < 34 || ascii(0, 4) !== 'ABIF') throw new ChromatogramError('not-abif', "This isn't an ABI chromatogram (.ab1): it doesn't start with ABIF")
  const dirCount = view.getInt32(18)
  const dirOffset = view.getInt32(26)
  if (dirCount < 0 || dirOffset < 0 || dirOffset + dirCount * 28 > bytes.byteLength)
    throw new ChromatogramError('truncated', 'The file is cut short: its directory points past the end')

  const entries = new Map<string, Entry>()
  for (let i = 0; i < dirCount; i++) {
    const at = dirOffset + i * 28
    const e: Entry = {
      name: ascii(at, 4),
      number: view.getInt32(at + 4),
      type: view.getInt16(at + 8),
      elementSize: view.getInt16(at + 10),
      count: view.getInt32(at + 12),
      size: view.getInt32(at + 16),
      // Data of four bytes or fewer sits in the offset field itself.
      offset: view.getInt32(at + 16) <= 4 ? at + 20 : view.getInt32(at + 20),
      at,
    }
    entries.set(`${e.name}${e.number}`, e)
  }

  const slice = (key: string) => {
    const e = entries.get(key)
    if (!e) return null
    if (e.size < 0 || e.offset < 0 || e.offset + e.size > bytes.byteLength) throw new ChromatogramError('bad-entry', `The file's ${key} entry points past the end`)
    return { e, data: bytes.subarray(e.offset, e.offset + e.size) }
  }
  const chars = (key: string) => {
    const s = slice(key)
    return s ? String.fromCharCode(...s.data) : null
  }
  const pString = (key: string) => {
    const s = slice(key)
    if (!s || s.data.length === 0) return null
    // Type 18 is a Pascal string (length first); type 19 a C string. Others are read as plain characters.
    const text = s.e.type === 18 ? String.fromCharCode(...s.data.subarray(1, 1 + s.data[0]!)) : String.fromCharCode(...s.data).replace(/\0+$/, '')
    return text.trim() || null
  }
  const shorts = (key: string) => {
    const s = slice(key)
    if (!s) return null
    const out = new Int16Array(s.e.count)
    const v = new DataView(s.data.buffer, s.data.byteOffset, s.data.byteLength)
    if (s.e.count * 2 > s.data.byteLength) throw new ChromatogramError('bad-entry', `The file's ${key} entry is shorter than it says`)
    for (let i = 0; i < s.e.count; i++) out[i] = v.getInt16(i * 2)
    return out
  }

  const bases = (chars('PBAS2') ?? chars('PBAS1'))?.replace(/\0+$/, '').toUpperCase() ?? ''
  if (!bases) throw new ChromatogramError('no-bases', 'The chromatogram has no base calls (no PBAS entry); it may be a fragment-analysis file')
  const q = slice('PCON2') ?? slice('PCON1')
  const quality = q ? [...q.data.subarray(0, bases.length)] : null
  const ploc = shorts('PLOC2') ?? shorts('PLOC1')
  const order = chars('FWO_1')
  const channels = ['DATA9', 'DATA10', 'DATA11', 'DATA12'].map((k) => shorts(k))
  const traces =
    order && order.length >= 4 && channels.every(Boolean)
      ? (Object.fromEntries([...order.slice(0, 4).toUpperCase()].map((b, i) => [b, channels[i]!])) as ChromatogramRead['traces'])
      : null

  return {
    format: 'abif',
    sampleName: pString('SMPL1'),
    instrument: pString('MODL1'),
    bases,
    quality: quality && quality.length === bases.length ? quality : null,
    peaks: ploc && ploc.length >= bases.length ? [...ploc.subarray(0, bases.length)] : null,
    traces: traces && 'A' in traces && 'C' in traces && 'G' in traces && 'T' in traces ? traces : null,
  }
}

/**
 * Quality trimming by Mott's algorithm, as Phred and Biopython's `abi-trim` do: each base scores `cutoff − P(error)`,
 * and the kept region is the stretch with the highest total. Returns null when no stretch scores above zero.
 */
export function mottTrim(quality: readonly number[], cutoff = 0.05): { start: number; end: number } | null {
  let best = 0
  let bestStart = 0
  let bestEnd = 0
  let sum = 0
  let start = 0
  for (let i = 0; i < quality.length; i++) {
    sum += cutoff - 10 ** (-quality[i]! / 10)
    if (sum <= 0) {
      sum = 0
      start = i + 1
    } else if (sum > best) {
      best = sum
      bestStart = start
      bestEnd = i + 1
    }
  }
  return best > 0 ? { start: bestStart, end: bestEnd } : null
}

export type ReadSettings = {
  /** Mott trimming cutoff (error probability). */
  trimCutoff: number
  /** Bases inside the kept region below this Phred quality become N. */
  minQuality: number
  /** A kept region shorter than this is not usable. */
  minLength: number
  /** A second peak at least this fraction of the called one marks a mixed position. */
  mixedPeakRatio: number
}

/** Stated defaults, not calibrated: Phred/Biopython's trimming cutoff, Q20, 100 bases, and a one-third second peak. */
export const DEFAULT_READ_SETTINGS: ReadSettings = { trimCutoff: 0.05, minQuality: 20, minLength: 100, mixedPeakRatio: 0.33 }

export type MixedPeak = { position: number; called: string; second: string; ratio: number }

export type ReadAssessment = {
  status: 'usable' | 'short' | 'failed'
  /** The kept region in the raw read, half-open, or null when nothing was kept. */
  kept: { start: number; end: number } | null
  /** The kept bases, with low-quality ones as N. Empty when nothing was kept. */
  sequence: string
  rawLength: number
  /** Bases inside the kept region turned into N for low quality. */
  maskedBases: number
  meanQuality: number | null
  /** Share of kept bases at or above `minQuality`. */
  highQualityShare: number | null
  /** Positions in `sequence` where a second peak is high, which can mean a mixed sample, a nuclear copy or heteroplasmy. Null without traces. */
  mixedPeaks: MixedPeak[] | null
  settings: ReadSettings
  notes: string[]
}

/** Trims and judges one read. It never rewrites a call except to N, and says why every base was dropped or masked. */
export function assessRead(read: ChromatogramRead, settings: Partial<ReadSettings> = {}): ReadAssessment {
  const s = { ...DEFAULT_READ_SETTINGS, ...settings }
  const base = { rawLength: read.bases.length, settings: s }
  if (!read.quality)
    return { ...base, status: 'failed', kept: null, sequence: '', maskedBases: 0, meanQuality: null, highQualityShare: null, mixedPeaks: null, notes: ['The file has no quality values, so the read can\'t be trimmed or judged. It is not used.'] }
  const kept = mottTrim(read.quality, s.trimCutoff)
  if (!kept)
    return { ...base, status: 'failed', kept: null, sequence: '', maskedBases: 0, meanQuality: 0, highQualityShare: 0, mixedPeaks: null, notes: ['No stretch of the read is above the quality cutoff: the read failed.'] }
  const q = read.quality.slice(kept.start, kept.end)
  let masked = 0
  const sequence = [...read.bases.slice(kept.start, kept.end)]
    .map((b, i) => {
      if (q[i]! < s.minQuality && b !== 'N') {
        masked++
        return 'N'
      }
      return b
    })
    .join('')
  const mean = q.reduce((a, b) => a + b, 0) / q.length
  const high = q.filter((x) => x >= s.minQuality).length / q.length
  const mixedPeaks = read.traces && read.peaks ? mixedPeaksIn(read, kept, s.mixedPeakRatio) : null
  const notes = [`Kept bases ${kept.start + 1} to ${kept.end} of ${read.bases.length} by quality.`]
  if (masked) notes.push(`${masked} kept base${masked === 1 ? '' : 's'} below Q${s.minQuality} became N.`)
  if (mixedPeaks?.length) notes.push(`${mixedPeaks.length} position${mixedPeaks.length === 1 ? ' has' : 's have'} a strong second peak: possibly a mixed sample, a nuclear copy or heteroplasmy. Calls are unchanged.`)
  if (!mixedPeaks) notes.push('The file has no traces, so second peaks weren\'t checked.')
  const status = kept.end - kept.start < s.minLength ? 'short' : 'usable'
  if (status === 'short') notes.push(`Only ${kept.end - kept.start} bases kept, under the ${s.minLength} needed.`)
  return { ...base, status, kept, sequence, maskedBases: masked, meanQuality: Math.round(mean * 10) / 10, highQualityShare: Math.round(high * 1000) / 1000, mixedPeaks, notes }
}

function mixedPeaksIn(read: ChromatogramRead, kept: { start: number; end: number }, ratio: number): MixedPeak[] {
  const traces = read.traces!
  const out: MixedPeak[] = []
  for (let i = kept.start; i < kept.end; i++) {
    const at = read.peaks![i]!
    const called = read.bases[i]!
    if (!(called in traces)) continue
    const heights = (['A', 'C', 'G', 'T'] as const).map((b) => ({ b, h: Math.max(0, traces[b][at] ?? 0) }))
    const own = heights.find((x) => x.b === called)!.h
    if (own <= 0) continue
    const second = heights.filter((x) => x.b !== called).sort((a, b) => b.h - a.h)[0]!
    const r = second.h / own
    if (r >= ratio) out.push({ position: i - kept.start, called, second: second.b, ratio: Math.round(r * 100) / 100 })
  }
  return out
}

export type PrimerSite = { start: number; end: number; mismatches: number }
export type PrimerHit = { status: 'found'; site: PrimerSite } | { status: 'absent' } | { status: 'multiple'; sites: PrimerSite[] }

/** Where a primer matches `reference` on the given strand, allowing IUPAC codes in the primer and up to `maxMismatches`. */
function findPrimer(primer: string, reference: string, maxMismatches: number): PrimerHit {
  const p = primer.toUpperCase().replace(/[^A-Z]/g, '')
  const ref = reference.toUpperCase()
  let best: PrimerSite[] = []
  for (let i = 0; i + p.length <= ref.length; i++) {
    let mm = 0
    for (let j = 0; j < p.length && mm <= maxMismatches; j++) {
      const allowed = basesOf(p[j])
      const r = ref[i + j]!
      if (!allowed || !basesOf(r) || ![...basesOf(r)!].some((b) => allowed.includes(b))) mm++
    }
    if (mm > maxMismatches) continue
    if (!best.length || mm < best[0]!.mismatches) best = [{ start: i, end: i + p.length, mismatches: mm }]
    else if (mm === best[0]!.mismatches) best.push({ start: i, end: i + p.length, mismatches: mm })
  }
  if (!best.length) return { status: 'absent' }
  return best.length === 1 ? { status: 'found', site: best[0]! } : { status: 'multiple', sites: best }
}

export type WindowCoverage = { window: string; label: string; coverage: 'whole' | 'partial' | 'none'; columns: number; of: number }

export type PrimerCheck =
  | {
      status: 'ok'
      forward: PrimerSite
      reverse: PrimerSite
      /** The amplicon in reference coordinates, half-open, primers included. */
      amplicon: { start: number; end: number }
      /** What the sample's own DNA can tell: the amplicon without the primer sites, whose bases come from the primers. */
      informative: { start: number; end: number }
      windows: WindowCoverage[]
    }
  | { status: 'refused'; reason: string; forward: PrimerHit; reverse: PrimerHit }

/**
 * Which panel windows a primer pair can cover. `reference` may be longer than the marker (primers often sit just
 * outside it, in the neighbouring tRNAs); `markerOffset` says where the marker, and so the windows, start in it.
 * A primer found nowhere, or in two equally good places, is a refusal, not a guess.
 */
export function checkPrimers(options: {
  forward: string
  reverse: string
  reference: string
  windows: readonly PanelWindow[]
  markerOffset?: number
  maxMismatches?: number
}): PrimerCheck {
  const { forward, reverse, reference, windows, markerOffset = 0, maxMismatches = 3 } = options
  const f = findPrimer(forward, reference, maxMismatches)
  // The reverse primer reads the other strand, so its reverse complement lies on this one.
  const r = findPrimer(reverseComplement(reverse.toUpperCase().replace(/[^A-Z]/g, '')), reference, maxMismatches)
  const refuse = (reason: string): PrimerCheck => ({ status: 'refused', reason, forward: f, reverse: r })
  if (f.status === 'absent') return refuse(`The forward primer matches nowhere in the reference within ${maxMismatches} mismatches. If it sits outside the marker, give a longer reference and the marker's offset.`)
  if (r.status === 'absent') return refuse(`The reverse primer matches nowhere in the reference within ${maxMismatches} mismatches. If it sits outside the marker, give a longer reference and the marker's offset.`)
  if (f.status === 'multiple') return refuse(`The forward primer matches ${f.sites.length} places equally well, so the amplicon can't be placed.`)
  if (r.status === 'multiple') return refuse(`The reverse primer matches ${r.sites.length} places equally well, so the amplicon can't be placed.`)
  if (r.site.end <= f.site.start) return refuse('The reverse primer lies before the forward one: check that they are given the right way round.')
  const informative = { start: f.site.end - markerOffset, end: r.site.start - markerOffset }
  return {
    status: 'ok',
    forward: f.site,
    reverse: r.site,
    amplicon: { start: f.site.start, end: r.site.end },
    informative,
    windows: windows.map((w) => {
      const columns = Math.max(0, Math.min(w.end, informative.end) - Math.max(w.start, informative.start))
      const of = w.end - w.start
      return { window: w.id, label: w.label, coverage: columns === of ? 'whole' : columns > 0 ? 'partial' : 'none', columns, of }
    }),
  }
}
