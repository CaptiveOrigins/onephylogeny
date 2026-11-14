/**
 * A consensus from reads mapped to a reference (ADR 0010, decisions 1 and 2). The input is `samtools
 * mpileup` text, which any lab pipeline can make from a BAM or CRAM. Each position's bases are counted (above a base
 * quality), and the consensus base is written only where depth and agreement are enough. Positions with a strong
 * minority base, which can mean a nuclear copy, a mixed sample or heteroplasmy, are reported, never resolved.
 */

export type BaseCounts = { A: number; C: number; G: number; T: number; deletion: number }
export type PileupPosition = { pos: number; ref: string; counts: BaseCounts; insertions: number }

export class PileupError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `Line ${line}: ${message}` : message)
    this.name = 'PileupError'
  }
}

/** Reads `samtools mpileup` text for one reference sequence, counting bases at or above `minBaseQuality`. */
export function parseMpileup(text: string, options: { minBaseQuality?: number } = {}): { chrom: string | null; positions: PileupPosition[] } {
  const minQ = options.minBaseQuality ?? 20
  const positions: PileupPosition[] = []
  let chrom: string | null = null
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    const cols = line.split('\t')
    if (cols.length < 6) throw new PileupError(`Expected at least 6 columns (chrom, pos, ref, depth, bases, qualities), found ${cols.length}`, i + 1)
    const [c, p, refBase, , bases, quals] = cols as [string, string, string, string, string, string]
    if (chrom !== null && c !== chrom) throw new PileupError(`More than one reference sequence (${chrom} and ${c}); give one at a time`, i + 1)
    chrom = c
    const ref = refBase.toUpperCase()
    const counts: BaseCounts = { A: 0, C: 0, G: 0, T: 0, deletion: 0 }
    let insertions = 0
    let q = 0
    for (let k = 0; k < bases.length; k++) {
      const ch = bases[k]!
      if (ch === '^') {
        k++ // the mapping quality follows a read start
        continue
      }
      if (ch === '$') continue
      if (ch === '+' || ch === '-') {
        const m = /^\d+/.exec(bases.slice(k + 1))
        if (!m) throw new PileupError(`An indel without a length at column ${k + 1}`, i + 1)
        if (ch === '+') insertions++
        k += m[0].length + Number(m[0])
        continue
      }
      const quality = (quals.charCodeAt(q) || 33) - 33
      q++
      if (ch === '*' || ch === '#') {
        counts.deletion++
        continue
      }
      const base = ch === '.' || ch === ',' ? ref : ch.toUpperCase()
      if (quality < minQ) continue
      if (base === 'A' || base === 'C' || base === 'G' || base === 'T') counts[base]++
    }
    if (q !== quals.length) throw new PileupError(`${q} bases but ${quals.length} qualities`, i + 1)
    positions.push({ pos: Number(p), ref, counts, insertions })
  })
  return { chrom, positions }
}

export type ConsensusSettings = {
  /** Fewer good bases than this at a position: N. */
  minDepth: number
  /** The top base needs at least this share of good bases, or the position is N. */
  minMajority: number
  /** A second base with at least this share is reported as a mixed position. */
  mixedShare: number
}

/** Stated defaults, not calibrated (ADR 0010): depth 10, majority 0.8, a second base at 0.1. */
export const DEFAULT_CONSENSUS: ConsensusSettings = { minDepth: 10, minMajority: 0.8, mixedShare: 0.1 }

export type MixedPosition = { pos: number; top: string; second: string; topShare: number; secondShare: number; depth: number }

export type Consensus = {
  /** One character per reference position 1..length: a base, N (not enough), or '-' (reads say deleted). */
  sequence: string
  length: number
  covered: number
  lowDepth: number
  ambiguous: number
  deleted: number
  mixed: MixedPosition[]
  /** Positions where reads carry an insertion often enough to matter; insertions aren't added to the sequence. */
  insertions: number[]
  meanDepth: number
  settings: ConsensusSettings
}

/**
 * The consensus over a reference of `length` positions. Positions the pileup doesn't list have no reads and are N.
 * Nothing is guessed: too little depth or too little agreement is N, and every mixed position is listed.
 */
export function consensusFromPileup(positions: readonly PileupPosition[], length: number, settings: Partial<ConsensusSettings> = {}): Consensus {
  const s = { ...DEFAULT_CONSENSUS, ...settings }
  const out = Array<string>(length).fill('N')
  let covered = 0
  let lowDepth = 0
  let ambiguous = 0
  let deleted = 0
  let depthSum = 0
  const mixed: MixedPosition[] = []
  const insertions: number[] = []
  const seen = new Set<number>()
  for (const p of positions) {
    if (p.pos < 1 || p.pos > length) throw new PileupError(`Position ${p.pos} is outside the reference (1 to ${length})`)
    seen.add(p.pos)
    const entries = (['A', 'C', 'G', 'T', 'deletion'] as const).map((b) => ({ b, n: p.counts[b] })).sort((x, y) => y.n - x.n)
    const depth = entries.reduce((a, e) => a + e.n, 0)
    depthSum += depth
    if (depth < s.minDepth) {
      lowDepth++
      continue
    }
    const [top, second] = [entries[0]!, entries[1]!]
    const topShare = top.n / depth
    const secondShare = second.n / depth
    if (secondShare >= s.mixedShare) mixed.push({ pos: p.pos, top: top.b === 'deletion' ? '-' : top.b, second: second.b === 'deletion' ? '-' : second.b, topShare: round(topShare), secondShare: round(secondShare), depth })
    if (p.insertions / depth >= s.mixedShare) insertions.push(p.pos)
    if (topShare < s.minMajority) {
      ambiguous++
      continue
    }
    covered++
    if (top.b === 'deletion') {
      deleted++
      out[p.pos - 1] = '-'
    } else out[p.pos - 1] = top.b
  }
  lowDepth += length - seen.size
  return { sequence: out.join(''), length, covered, lowDepth, ambiguous, deleted, mixed, insertions, meanDepth: round(depthSum / length), settings: s }
}

const round = (x: number) => Math.round(x * 1000) / 1000
