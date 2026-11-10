import type { Diagnostic, Id } from './model.js'

/**
 * Sample QC (roadmap stage 4): named rules, each good, mediocre or bad, and an overall status, in the spirit of Nextclade's
 * QC. They describe the sequence's quality; they don't change what it is consistent with. Thresholds are a panel's own when
 * it seals them, otherwise these defaults, which are stated proposals and not calibrated.
 */
export type QcStatus = 'good' | 'mediocre' | 'bad'
export type QcRule = 'missing-data' | 'mixed-sites' | 'frame' | 'stops' | 'clustered-differences'
export type QcSettings = {
  /** Share of covered columns that are N or another ambiguity: mediocre at or above `mediocre`, bad at or above `bad`. */
  missingData: { mediocre: number; bad: number }
  /** Count of two- or three-base ambiguity codes (such as R or Y): in a haploid marker, a sign of mixed template. */
  mixedSites: { mediocre: number; bad: number }
  /** At least `minDifferences` differences from the nearest panel record within `window` columns is a cluster. */
  clusteredDifferences: { window: number; minDifferences: number; mediocre: number; bad: number }
}
export const DEFAULT_QC: QcSettings = {
  missingData: { mediocre: 0.01, bad: 0.05 },
  mixedSites: { mediocre: 1, bad: 3 },
  clusteredDifferences: { window: 30, minDifferences: 3, mediocre: 1, bad: 2 },
}
export type SampleQc = { overall: QcStatus; rules: { rule: QcRule; status: QcStatus; detail: string }[]; settings: 'panel' | 'default'; nearest?: Id }

const MIXED = /[RYKMSWBDHV]/
const BASES = new Set(['A', 'C', 'G', 'T'])
const level = (n: number, t: { mediocre: number; bad: number }): QcStatus => (n >= t.bad ? 'bad' : n >= t.mediocre ? 'mediocre' : 'good')
const RANK: Record<QcStatus, number> = { good: 0, mediocre: 1, bad: 2 }

/** Positions where both have an unambiguous base and they differ. */
function differences(a: string, b: string): number[] {
  const out: number[] = []
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!.toUpperCase()
    const y = b[i]!.toUpperCase()
    if (BASES.has(x) && BASES.has(y) && x !== y) out.push(i)
  }
  return out
}

/** Non-overlapping clusters: windows of `window` columns holding at least `min` differences. */
export function clusters(positions: number[], window: number, min: number): { start: number; end: number; count: number }[] {
  const out: { start: number; end: number; count: number }[] = []
  let i = 0
  while (i < positions.length) {
    let j = i
    while (j + 1 < positions.length && positions[j + 1]! - positions[i]! < window) j++
    if (j - i + 1 >= min) { out.push({ start: positions[i]!, end: positions[j]!, count: j - i + 1 }); i = j + 1 } else i++
  }
  return out
}

/**
 * QC for one aligned sample. `diagnostics` are the record checks it already went through (frame and stops come from
 * them); `panelSequences` are the panel's aligned records, the nearest of which anchors the clustered-differences rule.
 */
export function sampleQc(queryAligned: string, diagnostics: Diagnostic[], panelSequences: Record<string, string>, panelSettings?: QcSettings): SampleQc {
  const s = panelSettings ?? DEFAULT_QC
  const covered = [...queryAligned].filter((c) => c !== '-' && c !== '.')
  const missing = covered.filter((c) => !BASES.has(c.toUpperCase())).length
  const mixed = covered.filter((c) => MIXED.test(c.toUpperCase())).length
  const share = covered.length ? missing / covered.length : 0
  let nearest: Id | undefined
  let best: number[] | undefined
  let bestRate = Infinity
  for (const [id, seq] of Object.entries(panelSequences).sort(([a], [b]) => a.localeCompare(b))) {
    const d = differences(queryAligned, seq)
    let shared = 0
    for (let i = 0; i < Math.min(queryAligned.length, seq.length); i++) if (BASES.has(queryAligned[i]!.toUpperCase()) && BASES.has(seq[i]!.toUpperCase())) shared++
    if (!shared) continue
    const rate = d.length / shared
    if (rate < bestRate) { bestRate = rate; best = d; nearest = id }
  }
  const found = best ? clusters(best, s.clusteredDifferences.window, s.clusteredDifferences.minDifferences) : []
  const has = (code: string) => diagnostics.some((d) => d.code === code)
  const rules: SampleQc['rules'] = [
    { rule: 'missing-data', status: level(share, s.missingData), detail: `${missing} of ${covered.length} covered columns are N or ambiguous (${(share * 100).toFixed(1)}%)` },
    { rule: 'mixed-sites', status: level(mixed, s.mixedSites), detail: `${mixed} two- or three-base ambiguity codes` },
    { rule: 'frame', status: has('frame-shifting-indel') ? 'bad' : 'good', detail: has('frame-shifting-indel') ? 'Has an insertion or deletion that shifts the reading frame' : 'No frame-shifting insertion or deletion' },
    { rule: 'stops', status: has('internal-stop') ? 'bad' : 'good', detail: has('internal-stop') ? 'Has an in-frame stop codon: a possible nuclear copy or sequencing error' : 'No in-frame stop codon, or the frame isn\'t checked' },
    {
      rule: 'clustered-differences', status: best ? level(found.length, s.clusteredDifferences) : 'good',
      detail: best ? `${found.length} clusters of ${s.clusteredDifferences.minDifferences}+ differences within ${s.clusteredDifferences.window} columns, against the nearest panel record${found.length ? ` (columns ${found.map((c) => `${c.start + 1}–${c.end + 1}`).join(', ')})` : ''}` : 'No panel record shares columns with it',
    },
  ]
  const overall = rules.reduce<QcStatus>((w, r) => (RANK[r.status] > RANK[w] ? r.status : w), 'good')
  return { overall, rules, settings: panelSettings ? 'panel' : 'default', ...(nearest ? { nearest } : {}) }
}
