import { alignToReference, assessAlignment, coveredColumns, DEFAULT_GATES, LOCATE_FLANK, locateMarker, type ExternalId, type Id, type MarkerPlace, type PanelBundle, type PanelStatus } from '@captiveorigins/onephylogeny-core'

/**
 * Sample routing (roadmap stage 2, item 5): given a sequence, which installed panels apply? Each panel's own reference
 * and record checks decide, the same ones `testSample` runs first, so a panel that's suggested will accept the sequence.
 * Routing only suggests; it never picks a result, and a person chooses which panel to test against. Every panel that
 * applies is listed (ADR 0009, decision 6): a whole mitogenome gets its mitogenome panel and, when one is installed, a
 * cytb panel too, with cytb located inside it. Nothing is ranked by probability.
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
  /** The panel's marker: a gene's name, or "mitogenome". */
  marker: string
  /** Where the panel's marker was found in a longer sequence, such as cytb in a whole mitogenome. 0-based, half-open. */
  located?: { start: number; end: number; strand: '+' | '-' }
  /** Panels whose windows are genes: reference columns in the covered windows, each counted once where genes overlap. */
  windowColumns?: number
}

/** The part of a sample a panel tests: the whole sequence, or the panel's marker cut out of a much longer one. */
export type SampleMarker = { sequence: string; located?: MarkerPlace; manyPlaces?: MarkerPlace[] }

/**
 * A sample many times longer than a gene panel's reference, such as a whole mitogenome tested against a cytb panel,
 * has the marker cut out by similarity first, as fetch does for records (ADR 0009, decision 6). The cut-out part then
 * goes through the panel's usual checks. Two plausible places is a refusal, never a guess. A sample isn't known to be
 * circular (only a GenBank record says so), so a marker across its origin isn't joined up.
 */
export function markerInSample(sequence: string, bundle: PanelBundle): SampleMarker {
  const reference = bundle.referenceSequence
  if (!reference || bundle.panel.marker.kind !== 'gene') return { sequence }
  const factor = bundle.panel.gates.containerRecordFactor ?? DEFAULT_GATES.containerRecordFactor ?? Infinity
  if (sequence.replace(/[-.\s]/g, '').length < factor * reference.length) return { sequence }
  const location = locateMarker(sequence, reference)
  if (location.status === 'located') return { sequence: location.sequence, located: location.place }
  if (location.status === 'multiple') return { sequence, manyPlaces: location.places }
  return { sequence }
}

/** Where a located marker is, in plain words. Positions are 1-based, as a person counts, and include a few flanking bases the aligner trims. */
export const placeText = (marker: string, p: MarkerPlace) => `${marker} found in bases ${p.start + 1} to ${p.end} of the sample${p.strand === '-' ? ', on the reverse strand' : ''} (with up to ${LOCATE_FLANK} flanking bases each side)`

const markerName = (bundle: PanelBundle) => (bundle.panel.marker.kind === 'mitogenome' ? 'mitogenome' : (bundle.panel.marker.gene ?? bundle.panel.marker.kind))

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
    const marker = markerName(bundle)
    const base = { panel: { id: panel.id, version: panel.version, status: panel.status }, windows: [] as Id[], taxonMatches: options.taxonClaim ? panel.taxa.some((t) => same(t, options.taxonClaim!)) : ('unknown' as const), marker }
    if (!CURRENT.includes(panel.status)) return { ...base, applies: false, reason: `This panel is ${panel.status}, so it is not used for new samples` }
    if (!bundle.referenceSequence) return { ...base, applies: false, reason: 'This panel has no reference sequence; build it again' }
    const part = markerInSample(sequence, bundle)
    if (part.manyPlaces) return { ...base, applies: false, reason: `${marker} matches ${part.manyPlaces.length} places in this sample, so which one to test is ambiguous` }
    const located = part.located ? { located: { start: part.located.start, end: part.located.end, strand: part.located.strand } } : {}
    const found = part.located ? `${placeText(marker, part.located)}. ` : ''
    const a = alignToReference(part.sequence, bundle.referenceSequence)
    const errors = assessAlignment(a, { ...panel.gates, frameErrors: false }).filter((d) => d.severity === 'error')
    const measured = a ? { identity: a.identity, alignedColumns: a.matches + a.mismatches } : {}
    if (!a || errors.length) return { ...base, ...located, ...measured, applies: false, reason: found + (errors.map((e) => e.message).join('; ') || 'Does not align to this panel\'s reference') }
    const covered = panel.windows.filter((w) => [...a.aligned.slice(w.start, w.end)].filter((c) => c !== '-' && c !== 'N').length >= panel.rules.minSharedColumns)
    const windows = covered.map((w) => w.id)
    if (!windows.length) return { ...base, ...located, ...measured, applies: false, reason: `${found}Aligns to the reference, but covers none of this panel's windows with at least ${panel.rules.minSharedColumns} columns` }
    if (base.taxonMatches === false) return { ...base, ...located, ...measured, windows, applies: false, reason: `${found}Aligns, but the sample is recorded as a taxon this panel is not for` }
    const genes = panel.windows.some((w) => w.gene)
    const windowColumns = genes ? { windowColumns: coveredColumns(covered) } : {}
    const span = genes ? `covering ${windows.length} of ${panel.windows.length} genes (${windowColumns.windowColumns} reference columns)` : `covering ${windows.length} of ${panel.windows.length} windows`
    const taxon = base.taxonMatches === true ? ', for the taxon the sample is recorded as' : ''
    return { ...base, ...located, ...measured, ...windowColumns, windows, applies: true, reason: `${found}Aligns at ${(a.identity * 100).toFixed(1)}% identity over ${measured.alignedColumns} columns, ${span}${taxon}` }
  })
  // Panels that apply first; among them active before candidate, then more windows, then more columns. An order for
  // reading, not a likelihood: every panel that applies is listed, and a person chooses.
  const rank = (s: RouteSuggestion) => [s.applies ? 0 : 1, s.panel.status === 'active' ? 0 : 1, -s.windows.length, -(s.alignedColumns ?? 0)]
  return out.sort((x, y) => {
    const [a, b] = [rank(x), rank(y)]
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
    // Same panel: the newest version first.
    if (x.panel.id === y.panel.id) return newer(y.panel.version, x.panel.version)
    return String(x.panel.id).localeCompare(String(y.panel.id))
  })
}
