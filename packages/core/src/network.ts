import type { PanelBundle } from './build.js'
import type { Id } from './model.js'

/**
 * Haplotype network (roadmap stage 5): one window's haplotypes as a minimum spanning network. Only records covering the
 * window whole are used (ADR 0007), so fragments of different amplicons don't appear as distinct haplotypes. Nodes count
 * records, not individuals or population frequencies; edges carry the number of differing sites. It shows the panel's
 * data; it is not a tree and says nothing about ancestry.
 */
export type NetworkNode = { id: Id; records: Id[]; byGroup: Record<Id, number> }
export type NetworkEdge = { a: Id; b: Id; steps: number }
export type HaplotypeNetwork = { window: Id; columns: number; nodes: NetworkNode[]; edges: NetworkEdge[]; partial: number }

const BASES = new Set(['A', 'C', 'G', 'T'])
/** Differences over columns where both have an unambiguous base. */
export function steps(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < a.length; i++) if (BASES.has(a[i]!) && BASES.has(b[i]!) && a[i] !== b[i]) d++
  return d
}

export function haplotypeNetwork(bundle: PanelBundle, windowId: Id): HaplotypeNetwork {
  const w = bundle.panel.windows.find((x) => x.id === windowId)
  if (!w) throw new Error(`No window ${windowId} in this panel`)
  const groupOf = new Map<Id, Id>()
  for (const g of bundle.panel.groups) for (const e of g.evidence) if (!groupOf.has(e.record)) groupOf.set(e.record, g.id)
  const byHap = new Map<string, NetworkNode>()
  let partial = 0
  for (const [record, group] of [...groupOf].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    const s = bundle.sequences[record]
    if (!s) continue
    const slice = s.slice(w.start, w.end).toUpperCase()
    if (slice.length !== w.end - w.start || /[-.]/.test(slice)) { partial++; continue }
    let node = byHap.get(slice)
    if (!node) { node = { id: `h${byHap.size + 1}`, records: [], byGroup: {} }; byHap.set(slice, node) }
    node.records.push(record)
    node.byGroup[group] = (node.byGroup[group] ?? 0) + 1
  }
  const seqs = [...byHap.keys()]
  const nodes = [...byHap.values()]
  // Minimum spanning network: at each distance, add every edge joining components that were separate before that
  // distance, then merge. Ties are kept, so no arbitrary choice hides an equally short link.
  const pairs: { i: number; j: number; d: number }[] = []
  for (let i = 0; i < seqs.length; i++) for (let j = i + 1; j < seqs.length; j++) pairs.push({ i, j, d: steps(seqs[i]!, seqs[j]!) })
  pairs.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j)
  const parent = nodes.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)))
  const edges: NetworkEdge[] = []
  for (let k = 0; k < pairs.length; ) {
    const d = pairs[k]!.d
    const level: typeof pairs = []
    while (k < pairs.length && pairs[k]!.d === d) level.push(pairs[k++]!)
    const joining = level.filter((p) => find(p.i) !== find(p.j))
    for (const p of joining) edges.push({ a: nodes[p.i]!.id, b: nodes[p.j]!.id, steps: d })
    for (const p of joining) parent[find(p.i)] = find(p.j)
  }
  return { window: w.id, columns: w.end - w.start, nodes, edges, partial }
}
