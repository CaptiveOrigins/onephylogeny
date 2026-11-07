import { reverseComplement } from './sequence.js'

/**
 * Finds a marker in a long record that doesn't annotate it, such as a whole mitochondrial genome.
 * This only cuts out the region. The region then goes through the same alignment and checks as any other record,
 * so a poor match fails there rather than here. Two plausible places is a refusal, not a guess.
 */
export type MarkerPlace = { start: number; end: number; strand: '+' | '-'; wrapsOrigin: boolean; seedHits: number }
export type MarkerLocation =
  | { status: 'located'; sequence: string; place: MarkerPlace }
  | { status: 'absent'; seedHits: number; needed: number }
  | { status: 'multiple'; places: MarkerPlace[] }

export type LocateOptions = {
  circular?: boolean
  k?: number
  /** Shared seeds needed, as a fraction of the marker's length. Low on purpose: the checks that follow judge the match. */
  minSeedFraction?: number
  /** Bases kept beyond each end, so an insertion near the end can't cut off real marker. The aligner clips them. */
  flank?: number
  /** Seeds a second place needs, as a fraction of the best one, to count as another copy. Low, because it could be a nuclear copy. */
  secondPlaceFraction?: number
}

/** Bases kept beyond each end of a located marker. */
export const LOCATE_FLANK = 30

type Hit = { q: number; r: number }
type Cluster = { hits: Hit[]; seeds: number; first: number; last: number }

/** Groups seed hits lying near one diagonal. Insertions shift the diagonal, so a band stays together. */
function clusters(target: string, index: Map<string, number[]>, k: number, band: number): Cluster[] {
  const hits: (Hit & { d: number })[] = []
  for (let q = 0; q + k <= target.length; q++) {
    const positions = index.get(target.slice(q, q + k))
    if (positions) for (const r of positions) hits.push({ q, r, d: q - r })
  }
  hits.sort((x, y) => x.d - y.d || x.q - y.q)
  const out: Cluster[] = []
  let group: Hit[] = []
  const close = () => {
    if (group.length) {
      const sorted = [...group].sort((x, y) => x.q - y.q)
      out.push({ hits: sorted, seeds: new Set(sorted.map((h) => h.r)).size, first: sorted[0]!.q, last: sorted[sorted.length - 1]!.q })
    }
    group = []
  }
  let previous = Number.NEGATIVE_INFINITY
  for (const h of hits) {
    if (h.d - previous > band) close()
    group.push(h)
    previous = h.d
  }
  close()
  return out
}

export function locateMarker(sequence: string, reference: string, options: LocateOptions = {}): MarkerLocation {
  const { circular = false, k = 12, minSeedFraction = 0.01, flank = LOCATE_FLANK, secondPlaceFraction = 0.25 } = options
  const ref = reference.toUpperCase()
  const forward = sequence.toUpperCase().replace(/[-.]/g, '')
  const n = forward.length
  const needed = Math.max(5, Math.ceil(ref.length * minSeedFraction))
  const index = new Map<string, number[]>()
  for (let r = 0; r + k <= ref.length; r++) {
    const kmer = ref.slice(r, r + k)
    if (/^[ACGT]+$/.test(kmer)) index.set(kmer, [...(index.get(kmer) ?? []), r])
  }
  const extend = (s: string) => (circular ? s + s.slice(0, Math.min(n, ref.length + flank)) : s)
  const strands = ([['+', forward], ['-', reverseComplement(forward)]] as const).map(([strand, seq]) => {
    const target = extend(seq)
    // Starting past the origin is a repeat of something already seen, because the start of the record was appended.
    return { strand, target, found: clusters(target, index, k, 64).filter((c) => c.first < n) }
  })
  const all = strands.flatMap((s) => s.found.map((c) => ({ ...c, strand: s.strand, target: s.target }))).sort((x, y) => y.seeds - x.seeds)
  const best = all[0]
  if (!best || best.seeds < needed) return { status: 'absent', seedHits: best?.seeds ?? 0, needed }

  const place = (c: Cluster, strand: '+' | '-'): MarkerPlace => {
    const a = c.hits[0]!
    const b = c.hits[c.hits.length - 1]!
    const start = Math.max(0, a.q - a.r - flank)
    const end = Math.min(extend(forward).length, b.q + (ref.length - b.r) + flank)
    const span = end - start
    const low = start % n
    // Coordinates on the record as deposited, whichever strand held the marker.
    const shown = strand === '+' ? low : (n - ((low + span) % n)) % n
    return { start: shown, end: (shown + span - 1) % n + 1, strand, wrapsOrigin: end > n, seedHits: c.seeds }
  }

  // On a circular record, a marker across the origin also shows as a piece at the record's start. That's the same copy.
  const samePlace = (x: Cluster & { strand: string }) => circular && x.strand === best.strand && best.last >= n && x.last + n >= best.first && x.first + n <= best.last
  const others = all.slice(1).filter((c) => c.seeds >= best.seeds * secondPlaceFraction && c.seeds >= needed && !samePlace(c))
  if (others.length) return { status: 'multiple', places: [best, ...others].map((c) => place(c, c.strand)) }

  const a = best.hits[0]!
  const b = best.hits[best.hits.length - 1]!
  const from = Math.max(0, a.q - a.r - flank)
  const to = Math.min(best.target.length, b.q + (ref.length - b.r) + flank)
  return { status: 'located', sequence: best.target.slice(from, to), place: place(best, best.strand) }
}
