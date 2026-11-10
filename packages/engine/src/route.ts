import { alignToReference, assessAlignment, type ExternalId, type Id, type PanelBundle, type PanelStatus } from '@captiveorigins/onephylogeny-core'

/**
 * Sample routing (roadmap stage 2, item 5): given a sequence, which installed panels apply? Each panel's own reference
 * and record checks decide, the same ones `testSample` runs first, so a panel that's suggested will accept the sequence.
 * Routing only suggests; it never picks a result, and a person chooses which panel to test against.
 */
export type RouteSuggestion = {
  panel: { id: Id; version: string; status: PanelStatus }
  applies: boolean
  /** Why it applies or doesn't, in plain words. */
  reason: string
  identity?: number
  alignedColumns?: number
  /** Windows the sequence covers with at least the panel's minimum shared columns. */
  windows: Id[]
  /** True, false, or unknown when the sequence carries no taxon claim. */
  taxonMatches: boolean | 'unknown'
}

const CURRENT: PanelStatus[] = ['active', 'candidate']
/** Compares dotted versions by number, so 0.10.0 is newer than 0.9.1. */
const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return a.localeCompare(b)
}
const same = (a: ExternalId, b: ExternalId) => a.source === b.source && String(a.id) === String(b.id)

export function routeSample(sequence: string, bundles: PanelBundle[], options: { taxonClaim?: ExternalId } = {}): RouteSuggestion[] {
  const out = bundles.map((bundle): RouteSuggestion => {
    const { panel } = bundle
    const base = { panel: { id: panel.id, version: panel.version, status: panel.status }, windows: [] as Id[], taxonMatches: options.taxonClaim ? panel.taxa.some((t) => same(t, options.taxonClaim!)) : ('unknown' as const) }
    if (!CURRENT.includes(panel.status)) return { ...base, applies: false, reason: `This panel is ${panel.status}, so it is not used for new samples` }
    if (!bundle.referenceSequence) return { ...base, applies: false, reason: 'This panel has no reference sequence; build it again' }
    const a = alignToReference(sequence, bundle.referenceSequence)
    const errors = assessAlignment(a, { ...panel.gates, frameErrors: false }).filter((d) => d.severity === 'error')
    const measured = a ? { identity: a.identity, alignedColumns: a.matches + a.mismatches } : {}
    if (!a || errors.length) return { ...base, ...measured, applies: false, reason: errors.map((e) => e.message).join('; ') || 'Does not align to this panel\'s reference' }
    const windows = panel.windows.filter((w) => [...a.aligned.slice(w.start, w.end)].filter((c) => c !== '-' && c !== 'N').length >= panel.rules.minSharedColumns).map((w) => w.id)
    if (!windows.length) return { ...base, ...measured, applies: false, reason: `Aligns to the reference, but covers none of this panel's windows with at least ${panel.rules.minSharedColumns} columns` }
    if (base.taxonMatches === false) return { ...base, ...measured, windows, applies: false, reason: 'Aligns, but the sample is recorded as a taxon this panel is not for' }
    return { ...base, ...measured, windows, applies: true, reason: `Aligns at ${(a.identity * 100).toFixed(1)}% identity over ${measured.alignedColumns} columns, covering ${windows.length} of ${panel.windows.length} windows` }
  })
  // Panels that apply first; among them active before candidate, then more windows, then more columns.
  const rank = (s: RouteSuggestion) => [s.applies ? 0 : 1, s.panel.status === 'active' ? 0 : 1, -s.windows.length, -(s.alignedColumns ?? 0)]
  return out.sort((x, y) => {
    const [a, b] = [rank(x), rank(y)]
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
    // Same panel: the newest version first.
    if (x.panel.id === y.panel.id) return newer(y.panel.version, x.panel.version)
    return String(x.panel.id).localeCompare(String(y.panel.id))
  })
}
