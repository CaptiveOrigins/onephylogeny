import { notActiveScope } from './build.js'
import { LOCATION_EVIDENCE } from './panel.js'
import type { Id, Panel, Result } from './model.js'

/** Card text. Hosts pass their own, translated, with `{regions}` where the region names go. */
export type RegionCardLabels = {
  /** Shown first for a `candidate` panel a maintainer chose to show. */
  exploratory: string
  /** Shown first for an `active` panel whose claims aren't all confirmatory. */
  reviewedExploratory: string
  /** Shown first for an `active` panel whose claims are all confirmatory. Empty by default. */
  reviewed: string
  match: string
  /** Also goes in every export of the card, such as JSON. */
  caveat: string
  /** Joins region names. */
  separator: string
}

export const REGION_CARD_LABELS: RegionCardLabels = {
  exploratory: 'Exploratory: not yet reviewed. Built from records that also shaped the method, and not yet tested on independent data.',
  reviewedExploratory: 'Reviewed. Claims are exploratory until tested on independent data.',
  reviewed: '',
  match: 'Matches a maternal line sampled in {regions}. Other regions are unsampled or untested.',
  caveat: 'Not proof of where this animal was collected.',
  separator: ', ',
}

export type RegionCardOptions = {
  /** `public` is anyone; `keeper` is the animal's own keeper. */
  audience: 'public' | 'keeper'
  /** The keeper chose to show regions publicly for this animal. Required for `public`. */
  publicOptIn?: boolean
  /** A maintainer chose to show this `candidate` panel as exploratory. Without it, candidates show nothing. */
  exploratoryShown?: boolean
  labels?: Partial<RegionCardLabels>
}

export type RegionCardLabel = 'exploratory' | 'reviewed-exploratory' | 'reviewed'

export type RegionCardRefusal =
  | 'wrong-panel' | 'not-opted-in' | 'panel-not-current' | 'candidate-not-shown'
  | 'no-single-match' | 'outside-validated-scope' | 'no-located-records' | 'no-region' | 'region-looks-like-coordinates'

export type RegionCard =
  | { show: true; group: Id; regions: string[]; label: RegionCardLabel; text: string; caveat: string }
  | { show: false; reason: RegionCardRefusal }

// Decimal degrees, degrees-minutes-seconds or a lat/lon pair. A region is a name, never a position.
const COORDINATE_LIKE = /-?\d{1,3}\.\d{2,}|\d{1,3}\s*°|\d{1,3}\s*[NSEW]\b|\b(lat|lon|lng|latitude|longitude)\b/i

/**
 * Invariant P30. Says whether a result may name regions on an animal's card, and with what words. Regions come only from
 * the matched group's records that can show where it occurs (P9, P12), so assigned records never add a region. It is a
 * hypothesis about the maternal line, never evidence of where the animal was collected.
 */
export function regionCard(panel: Panel, result: Result, options: RegionCardOptions): RegionCard {
  const no = (reason: RegionCardRefusal): RegionCard => ({ show: false, reason })
  const labels = { ...REGION_CARD_LABELS, ...options.labels }
  if (result.panel.id !== panel.id || result.panel.version !== panel.version || result.panel.checksum !== panel.checksum) return no('wrong-panel')
  if (options.audience === 'public' && options.publicOptIn !== true) return no('not-opted-in')
  if (panel.status !== 'active' && panel.status !== 'candidate') return no('panel-not-current')
  if (panel.status === 'candidate' && options.exploratoryShown !== true) return no('candidate-not-shown')
  const consistent = result.findings.filter((f) => f.status === 'consistent')
  if (consistent.length !== 1 || result.novelty.flagged) return no('no-single-match')
  // A candidate is never active, and that line is what the exploratory label says. Any other gap stops the card.
  if (result.outOfValidatedScope.some((r) => r !== notActiveScope(panel.status)) || !panel.claims.length) return no('outside-validated-scope')
  const group = panel.groups.find((g) => g.id === consistent[0]!.group)
  const located = group?.evidence.some((e) => e.use === 'lineage-and-location' && LOCATION_EVIDENCE.includes(e.provenanceClass) && (e.provenanceClass !== 'origin-reported' || Boolean(e.originSource)))
  if (!group || !located) return no('no-located-records')
  const region = group.region?.trim()
  if (!region) return no('no-region')
  if (COORDINATE_LIKE.test(region)) return no('region-looks-like-coordinates')
  const regions = [region]
  const label: RegionCardLabel = panel.status === 'candidate' ? 'exploratory' : panel.claims.every((c) => c.basis === 'confirmatory') ? 'reviewed' : 'reviewed-exploratory'
  const prefix = { exploratory: labels.exploratory, 'reviewed-exploratory': labels.reviewedExploratory, reviewed: labels.reviewed }[label]
  const text = [prefix, labels.match.replace('{regions}', regions.join(labels.separator)), labels.caveat].filter(Boolean).join(' ')
  return { show: true, group: group.id, regions, label, text, caveat: labels.caveat }
}
