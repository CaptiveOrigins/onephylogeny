/**
 * Mitogenome panels (ADR 0009, roadmap stage 6.1): gene windows read from one annotated reference.
 * Nothing is typed by hand and nothing is guessed: a gene whose annotation can't be placed plainly is left out, with
 * the reason, for the panel's `notCovered`.
 */
import type { GenBankRecord } from './genbank.js'
import type { PanelWindow } from './model.js'

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
