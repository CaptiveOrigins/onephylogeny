/**
 * Mitogenome panels (ADR 0009, roadmap stage 6.1): gene windows read from one annotated reference.
 * Nothing is typed by hand and nothing is guessed: a gene whose annotation can't be placed plainly is left out, with
 * the reason, for the panel's `notCovered`.
 */
import type { GenBankRecord } from './genbank.js'
import type { GeneticCode, PanelWindow } from './model.js'
import { basesOf, internalStops, reverseComplement } from './sequence.js'

export type LeftOutGene = { name: string; location: string; reason: string }
export type GeneWindows = { windows: PanelWindow[]; leftOut: LeftOutGene[]; notes: string[] }

/** Largest gap between the parts of a joined feature that still counts as one gene (ND3's extra base in turtles and birds). */
const MAX_JOIN_GAP = 10

const KINDS: Record<string, 'cds' | 'rrna' | 'trna'> = { CDS: 'cds', rRNA: 'rrna', tRNA: 'trna' }

/** The control region's usual feature keys and names. */
const CONTROL = /^(d-loop|control region|control_region)$/i

/**
 * One window per protein-coding gene, rRNA and tRNA in the reference's annotation, in reference order. Windows are
 * half-open, 0-based reference positions, like every panel window.
 *
 * Left out, each with its reason: the control region (ADR 0009, decision 3), any feature with a partial end (`<`, `>`),
 * a split or origin-crossing location, and a feature with no name. Two features with the same name are told apart by
 * their order ("tRNA-Leu (1)", "tRNA-Leu (2)").
 */
export function geneWindows(reference: GenBankRecord): GeneWindows {
  const leftOut: LeftOutGene[] = []
  const notes: string[] = []
  const found: (PanelWindow & { name: string })[] = []
  for (const f of reference.features) {
    const name = f.qualifiers.gene?.[0] ?? f.qualifiers.product?.[0] ?? ''
    if (f.key === 'D-loop' || (f.key === 'misc_feature' && CONTROL.test(f.qualifiers.note?.[0] ?? '')) || CONTROL.test(name)) {
      leftOut.push({ name: name || 'control region', location: f.location, reason: 'The control region is left out by default: repeats, length differences and heteroplasmy make column comparison unreliable (ADR 0009).' })
      continue
    }
    const kind = KINDS[f.key]
    if (!kind) continue
    if (!name) {
      leftOut.push({ name: `unnamed ${f.key}`, location: f.location, reason: 'The feature has no gene or product name.' })
      continue
    }
    const loc = f.location.trim()
    const m = /^complement\((\d+)\.\.(\d+)\)$/.exec(loc) ?? /^(\d+)\.\.(\d+)$/.exec(loc) ?? nearJoin(loc, notes, name)
    if (!m) {
      const why = /[<>]/.test(f.location) ? 'Its location has a partial end in the reference.' : /join|order/.test(f.location) ? 'Its location is split, or crosses the origin.' : 'Its location can\'t be read as one stretch.'
      leftOut.push({ name, location: f.location, reason: why })
      continue
    }
    const minus = loc.startsWith('complement(')
    const start = Number(m[1]) - 1
    const end = Number(m[2])
    if (end <= start || end > reference.sequence.length) {
      leftOut.push({ name, location: f.location, reason: 'Its location lies outside the reference sequence.' })
      continue
    }
    found.push({ id: '', label: '', name, start, end, gene: { kind, strand: minus ? '-' : '+' } })
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end)
  const counts = new Map<string, number>()
  for (const w of found) counts.set(w.name, (counts.get(w.name) ?? 0) + 1)
  const seen = new Map<string, number>()
  const windows = found.map(({ name, ...w }) => {
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    const label = counts.get(name)! > 1 ? `${name} (${n})` : name
    return { ...w, id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), label }
  })
  if (!found.length) notes.push('The reference has no usable gene annotation, so the panel has no gene windows.')
  if (!leftOut.some((g) => /control/i.test(g.reason))) notes.push('The reference annotates no control region. Columns outside every gene window are never evaluated.')
  return { windows, leftOut, notes }
}

/**
 * A join of parts on one strand, in order, with gaps of at most MAX_JOIN_GAP bases, is one gene with a skipped base or
 * two (the window spans it, and the skipped bases are noted). Anything else, including a join across the origin, isn't.
 */
function nearJoin(loc: string, notes: string[], name: string): [string, string, string] | null {
  const outer = /^(complement\()?join\((.*)\)\)?$/.exec(loc)
  if (!outer || Boolean(outer[1]) !== loc.endsWith('))')) return null
  const parts = outer[2]!.split(',').map((p) => /^(\d+)\.\.(\d+)$/.exec(p.trim()))
  if (parts.some((p) => !p)) return null
  const ranges = parts.map((p) => [Number(p![1]), Number(p![2])] as const)
  for (let i = 1; i < ranges.length; i++) {
    const gap = ranges[i]![0] - ranges[i - 1]![1] - 1
    if (gap < 0 || gap > MAX_JOIN_GAP) return null
  }
  const first = ranges[0]![0]
  const last = ranges[ranges.length - 1]![1]
  notes.push(`${name} is annotated in ${ranges.length} parts (${loc}); its window spans them, including the skipped base${last - first + 1 - ranges.reduce((a, r) => a + r[1] - r[0] + 1, 0) === 1 ? '' : 's'}.`)
  return [loc, String(first), String(last)]
}

/** Reference columns covered by at least one window. Genes overlap (ATP8 and ATP6, ND4L and ND4), so summaries count each column once. */
export function coveredColumns(windows: readonly PanelWindow[]): number {
  const sorted = [...windows].sort((a, b) => a.start - b.start)
  let total = 0
  let reach = -1
  for (const w of sorted) {
    const from = Math.max(w.start, reach)
    if (w.end > from) total += w.end - from
    reach = Math.max(reach, w.end)
  }
  return total
}

export type Rotation =
  | { status: 'rotated'; sequence: string; strand: '+' | '-'; shift: number }
  | { status: 'refused'; reason: string }

/**
 * Turns a complete, circular mitogenome so it starts where the reference starts and reads on the reference's strand,
 * before alignment (ADR 0009, decision 1). The start is placed from the first stretch of the reference that is unique in it
 * (a mitogenome often starts in repeats), by exact k-mer votes. A
 * partial record isn't circular and must not be turned; a start found nowhere, or in two places, is a refusal.
 */
export function rotateToReference(query: string, reference: string, options: { head?: number; k?: number } = {}): Rotation {
  const k = options.k ?? 16
  const size = options.head ?? 200
  const ref = reference.toUpperCase()
  // Anchor on the first stretch of the reference whose k-mers occur once in it. Mitogenomes often start in the
  // control region, whose tandem repeats would match many places.
  const refDoubled = ref + ref.slice(0, size)
  const unique = (from: number) => {
    let ok = 0
    let all = 0
    for (let j = from; j + k <= from + size; j++) {
      const kmer = refDoubled.slice(j, j + k)
      if (!/^[ACGT]+$/.test(kmer)) continue
      all++
      const first = refDoubled.indexOf(kmer)
      const again = refDoubled.indexOf(kmer, first + 1)
      if (again < 0 || again >= ref.length + first) ok++
    }
    return all > 0 && ok / all >= 0.9
  }
  let anchor = -1
  for (let from = 0; from + size <= ref.length; from += 50) if (unique(from)) { anchor = from; break }
  if (anchor < 0) return { status: 'refused', reason: 'The reference has no stretch unique enough to anchor on.' }
  const head = ref.slice(anchor, anchor + size)
  // Each exact k-mer of the anchor votes for where the reference's start falls in the record. Exact matches only:
  // an estimate a few bases off would shift every column after it.
  const vote = (seq: string) => {
    const n = seq.length
    const doubled = seq + seq.slice(0, head.length)
    const votes = new Map<number, number>()
    for (let j = 0; j + k <= head.length; j++) {
      const kmer = head.slice(j, j + k)
      if (!/^[ACGT]+$/.test(kmer)) continue
      let at = doubled.indexOf(kmer)
      const seen = new Set<number>()
      while (at >= 0 && at < n + j) {
        const start = (((at - j - anchor) % n) + n) % n
        if (!seen.has(start)) {
          seen.add(start)
          votes.set(start, (votes.get(start) ?? 0) + 1)
        }
        at = doubled.indexOf(kmer, at + 1)
      }
    }
    return [...votes.entries()].sort((a, b) => b[1] - a[1])
  }
  const forward = query.toUpperCase()
  const backward = reverseComplement(forward)
  const options2 = ([['+', forward], ['-', backward]] as const).map(([strand, seq]) => ({ strand, seq, votes: vote(seq) }))
  const ranked = options2.flatMap((o) => o.votes.map(([start, count]) => ({ strand: o.strand, seq: o.seq, start, count }))).sort((a, b) => b.count - a.count)
  const best = ranked[0]
  const needed = Math.max(5, Math.floor((head.length - k + 1) / 4))
  if (!best || best.count < needed) return { status: 'refused', reason: "The reference's start couldn't be found in this record, so it can't be turned to match." }
  const rival = ranked[1]
  if (rival && rival.count >= best.count / 2) return { status: 'refused', reason: "The reference's start matches more than one place in this record, so where it starts is ambiguous." }
  return { status: 'rotated', sequence: best.seq.slice(best.start) + best.seq.slice(0, best.start), strand: best.strand, shift: best.start }
}

export type GeneCheck = {
  window: string
  label: string
  /** Share of the gene's reference columns where the query has a base. */
  coverage: number
  status: 'ok' | 'stops' | 'frame' | 'partial' | 'not-checked'
  detail: string
}

/**
 * Frame and stop codons for each protein-coding gene window, on the gene's own strand (ADR 0009, decision 4).
 * `queryAligned` is in reference coordinates, as every aligned record is. A gene the query covers only in part isn't
 * judged. A gene whose reference doesn't read cleanly (ND3's untranslated extra base in turtles) isn't judged either,
 * because the same plain reading would flag every record.
 */
export function geneChecks(queryAligned: string, reference: string, windows: readonly PanelWindow[], code: GeneticCode, minCoverage = 0.95): GeneCheck[] {
  return windows
    .filter((w) => w.gene?.kind === 'cds')
    .map((w) => {
      const orient = (s: string) => (w.gene!.strand === '-' ? reverseComplement(s) : s.toUpperCase())
      const q = orient(queryAligned.slice(w.start, w.end))
      const r = orient(reference.slice(w.start, w.end))
      const bases = [...q].filter((c) => basesOf(c)).length
      const coverage = Math.round((bases / (w.end - w.start)) * 1000) / 1000
      const base = { window: w.id, label: w.label, coverage }
      if (coverage < minCoverage) return { ...base, status: 'partial', detail: `Covers ${Math.round(coverage * 100)}% of the gene, so frame and stops weren't judged.` }
      if (internalStops(r, 0, code).length) return { ...base, status: 'not-checked', detail: "The reference itself doesn't read cleanly here (for example an untranslated extra base), so a plain reading can't judge the query." }
      // Only gaps between the first and last base: missing ends are coverage, not a frameshift.
      const inner = q.replace(/^[^ACGTRYSWKMBDHV]+|[^ACGTRYSWKMBDHV]+$/gi, '')
      const gaps = [...inner].filter((c) => c === '-').length
      if (gaps % 3 !== 0) return { ...base, status: 'frame', detail: `${gaps} missing column${gaps === 1 ? '' : 's'} inside the gene, not a multiple of three: a frameshift, a misread or a nuclear copy.` }
      const lead = /^[^ACGTRYSWKMBDHV]*/i.exec(q)![0].length
      const stops = internalStops(inner, (3 - (lead % 3)) % 3, code)
      if (stops.length) return { ...base, status: 'stops', detail: `${stops.length} internal stop codon${stops.length === 1 ? '' : 's'}: a misread or a nuclear copy.` }
      return { ...base, status: 'ok', detail: 'In frame, with no internal stops.' }
    })
}
