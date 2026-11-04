import type { Id, LengthUnit, Phylogeny, Support } from '@captiveorigins/onetaxonomy-core'
import { parseNewick } from '@captiveorigins/onetaxonomy-import'

export type TreeExportOptions = {
  id: Id
  title: string
  version: string
  sources: Id[]
  citation?: string
  /** Whether an outgroup rooted this tree. A tree's nesting alone doesn't make its root known. */
  rooted: boolean
  lengthUnit?: LengthUnit
  sampling?: Phylogeny['sampling']
  /** Names of paired support values, in label order, such as ['SH-aLRT', 'UFBoot']. */
  supportMethods?: string[]
  /** Explicit tip to concept mapping. Unmapped tips stay unmapped: names are never matched by guesswork. */
  conceptsForTip?: (tip: string) => Id[] | undefined
}

type NodeWithSupport = Phylogeny['nodes'][number] & { additionalSupport?: Support[] }

/**
 * Turns a tree into a OneTaxonomy hypothesis, which brings its monophyly checks and views. All support values are
 * kept; the first is the primary one, so viewers that read a single value still show something true.
 */
export function treeToPhylogeny(newick: string, options: TreeExportOptions): Phylogeny {
  const methods = options.supportMethods ?? []
  const phylogeny = parseNewick(newick, {
    id: options.id, title: options.title, version: options.version, sources: options.sources, rooted: options.rooted, internalLabels: 'label',
    ...(options.citation ? { citation: options.citation } : {}),
    ...(options.lengthUnit ? { lengthUnit: options.lengthUnit } : {}),
    ...(options.sampling ? { sampling: options.sampling } : {}),
    ...(options.conceptsForTip ? { mapLabel: (label: string, isTip: boolean) => (isTip ? options.conceptsForTip!(label) : undefined) } : {}),
  })
  const parents = new Set(phylogeny.edges.map((e) => e.parent))
  for (const raw of phylogeny.nodes) {
    const node = raw as NodeWithSupport
    if (!node.label || !parents.has(node.id)) continue
    const parts = node.label.split('/').map((v) => v.trim())
    if (!parts.every((v) => v !== '' && Number.isFinite(Number(v)))) continue
    if (methods.length && parts.length !== methods.length) continue
    const values = parts.map((v, i): Support => ({ value: Number(v), ...(methods[i] ? { method: methods[i] } : {}) }))
    node.support = values[0]!
    if (values.length > 1) node.additionalSupport = values.slice(1)
    delete node.label
  }
  return phylogeny
}
