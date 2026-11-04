import { reverseComplement } from './sequence.js'

export type Alignment = {
  /** The query in reference coordinates: same length as the reference, `-` where it has nothing. */
  aligned: string
  orientation: 'forward' | 'reverse'
  /** Bases the reference has no column for. Dropped from `aligned`, but always reported. */
  insertions: { at: number; length: number }[]
  /** Internal gaps in the query. */
  deletions: { at: number; length: number }[]
  matches: number
  mismatches: number
  /** matches / (matches + mismatches), or 0. */
  identity: number
  /** Query bases left outside the alignment at each end, after placing ends that look homologous. */
  clipped: { start: number; end: number }
  /** Bases at each end placed by following the terminal diagonal. */
  placedEnds: { start: number; end: number }
  queryLength: number
  seedHits: number
}

/** Identifies this aligner in run records. Bump the version when its results can change. */
export const ALIGNER = { name: 'alignToReference', version: '2' } as const

export type AlignOptions = { k?: number; band?: number; match?: number; mismatch?: number; gapOpen?: number; gapExtend?: number; minSeedHits?: number }

const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3, U: 3 }

function kmerIndex(ref: string, k: number): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (let i = 0; i + k <= ref.length; i++) {
    const key = ref.slice(i, i + k)
    if (/[^ACGT]/.test(key)) continue
    const list = index.get(key)
    if (list) list.push(i)
    else index.set(key, [i])
  }
  return index
}

function bestDiagonal(query: string, index: Map<string, number[]>, k: number): { diagonal: number; hits: number } {
  const votes = new Map<number, number>()
  for (let i = 0; i + k <= query.length; i++) {
    const hits = index.get(query.slice(i, i + k))
    if (!hits) continue
    for (const j of hits) votes.set(j - i, (votes.get(j - i) ?? 0) + 1)
  }
  let diagonal = 0
  let best = 0
  for (const [d, v] of votes) if (v > best || (v === best && d < diagonal)) { diagonal = d; best = v }
  return { diagonal, hits: best }
}

const NEGATIVE = -1e9
/** Tails this short can't pay for a mismatch under the scoring, so they get a lower bar. */
const SHORT_TAIL = 12
/** Tails this short can't be judged by identity: a single differing base scores 0%. Placing a wrong one adds at most this many differences. */
const TINY_TAIL = 5

/**
 * Projects a sequence onto reference coordinates, the job of `mafft --addfragments --keeplength`: local affine
 * alignment in a band around the best seed diagonal. No seeds in either orientation returns null, which is
 * how a different gene is caught. Pure and deterministic; adding other sequences can't change the result.
 */
export function alignToReference(sequence: string, reference: string, options: AlignOptions = {}): Alignment | null {
  const { k = 11, band = 64, match = 2, mismatch = -3, gapOpen = -8, gapExtend = -1, minSeedHits = 2 } = options
  const ref = reference.toUpperCase()
  const forward = sequence.toUpperCase().replace(/[-.]/g, '')
  const index = kmerIndex(ref, k)
  const reverse = reverseComplement(forward)
  const f = bestDiagonal(forward, index, k)
  const r = bestDiagonal(reverse, index, k)
  const useForward = f.hits >= r.hits
  const seed = useForward ? f : r
  if (seed.hits < minSeedHits) return null
  const query = useForward ? forward : reverse
  const n = query.length
  const m = ref.length
  const low = seed.diagonal - band
  const width = 2 * band + 1
  const trace = new Uint8Array((n + 1) * width)
  let hPrev = new Float64Array(width + 2).fill(NEGATIVE)
  let hCur = new Float64Array(width + 2).fill(NEGATIVE)
  let fPrev = new Float64Array(width + 2).fill(NEGATIVE)
  let fCur = new Float64Array(width + 2).fill(NEGATIVE)
  let best = 0
  let bestI = 0
  let bestK = 0
  for (let i = 0; i <= n; i++) {
    let e = NEGATIVE
    hCur.fill(NEGATIVE)
    fCur.fill(NEGATIVE)
    for (let w = 0; w < width; w++) {
      const j = i + low + w
      if (j < 0 || j > m) { e = NEGATIVE; continue }
      if (i === 0 || j === 0) { hCur[w + 1] = 0; e = NEGATIVE; continue }
      const a = CODE[query[i - 1]!]
      const b = CODE[ref[j - 1]!]
      const score = a === undefined || b === undefined ? 0 : a === b ? match : mismatch
      const diag = hPrev[w + 1]! + score
      const eOpen = hCur[w]! + gapOpen
      const eExtend = e + gapExtend
      e = Math.max(eOpen, eExtend)
      const fOpen = hPrev[w + 2]! + gapOpen
      const fExtend = fPrev[w + 2]! + gapExtend
      const g = Math.max(fOpen, fExtend)
      fCur[w + 1] = g
      let h = 0
      let from = 0
      if (diag > h) { h = diag; from = 1 }
      if (e > h) { h = e; from = 2 }
      if (g > h) { h = g; from = 3 }
      hCur[w + 1] = h
      trace[i * width + w] = from | (eExtend > eOpen ? 4 : 0) | (fExtend > fOpen ? 8 : 0)
      if (h > best) { best = h; bestI = i; bestK = w }
    }
    ;[hPrev, hCur] = [hCur, hPrev]
    ;[fPrev, fCur] = [fCur, fPrev]
  }
  const out = new Array<string>(m).fill('-')
  const insertions: Alignment['insertions'] = []
  const deletions: Alignment['deletions'] = []
  let matches = 0
  let mismatches = 0
  let i = bestI
  let w = bestK
  let state: 'H' | 'E' | 'F' = 'H'
  while (i > 0 && i + low + w > 0) {
    const t = trace[i * width + w]!
    if (state === 'H') {
      const from = t & 3
      if (from === 0) break
      if (from === 1) {
        const j = i + low + w
        const qb = query[i - 1]!
        out[j - 1] = qb
        if (qb === ref[j - 1]) matches++
        else if (CODE[qb] !== undefined && CODE[ref[j - 1]!] !== undefined) mismatches++
        i--
        continue
      }
      state = from === 2 ? 'E' : 'F'
    }
    if (state === 'E') {
      const j = i + low + w
      const last = deletions[deletions.length - 1]
      if (last && last.at === j) { last.at = j - 1; last.length++ }
      else deletions.push({ at: j - 1, length: 1 })
      if (!(t & 4)) state = 'H'
      w--
    } else {
      const j = i + low + w
      const last = insertions[insertions.length - 1]
      if (last && last.at === j) last.length++
      else insertions.push({ at: j, length: 1 })
      if (!(t & 8)) state = 'H'
      i--
      w++
    }
  }
  // Local alignment drops ends where a few matches can't repay a mismatch, and those can be real differences.
  // Follow the terminal diagonal when the whole tail looks homologous; a real flank or junk stays clipped.
  const tailLooksHomologous = (length: number, same: number, known: number) => length <= TINY_TAIL || (known > 0 && same / known >= (length <= SHORT_TAIL ? 0.5 : 0.7))
  const placeEnd = (pairs: [number, number][]) => {
    let same = 0
    let known = 0
    for (const [q, r] of pairs) {
      const a = CODE[query[q]!]
      const b = CODE[ref[r]!]
      if (a === undefined || b === undefined) continue
      known++
      if (a === b) same++
    }
    if (!tailLooksHomologous(pairs.length, same, known)) return 0
    for (const [q, r] of pairs) out[r] = query[q]!
    matches += same
    mismatches += known - same
    return pairs.length
  }
  const startQuery = i
  const startRef = i + low + w
  const endRef = bestI + low + bestK
  const before = Math.min(startQuery, startRef)
  const after = Math.min(n - bestI, m - endRef)
  const placedStart = placeEnd(Array.from({ length: before }, (_, k): [number, number] => [startQuery - before + k, startRef - before + k]))
  const placedEnd = placeEnd(Array.from({ length: after }, (_, k): [number, number] => [bestI + k, endRef + k]))
  const compared = matches + mismatches
  return {
    aligned: out.join(''),
    orientation: useForward ? 'forward' : 'reverse',
    insertions: insertions.reverse(),
    deletions: deletions.reverse(),
    matches,
    mismatches,
    identity: compared ? matches / compared : 0,
    clipped: { start: startQuery - placedStart, end: n - bestI - placedEnd },
    placedEnds: { start: placedStart, end: placedEnd },
    queryLength: n,
    seedHits: seed.hits,
  }
}
