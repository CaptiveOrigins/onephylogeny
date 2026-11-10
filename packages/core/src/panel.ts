import type { PanelBundle } from './build.js'
import { deriveEvaluation } from './derive.js'
import type { Diagnostic, Panel, ProvenanceClass, Result } from './model.js'
import { sha256Hex } from './sha256.js'

/** JSON with sorted keys, so the same content always has the same checksum. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Status can change over a panel's life, so it isn't part of what the checksum identifies. */
export function panelChecksum(panel: Panel): string {
  const { checksum: _checksum, status: _status, ...content } = panel
  return `sha256:${sha256Hex(canonicalJson(content))}`
}

export const sealPanel = (panel: Panel): Panel => ({ ...panel, checksum: panelChecksum(panel) })

export const verifyPanel = (panel: Panel): boolean => panel.checksum === panelChecksum(panel)

/** Hashes what travels beside a panel's JSON. Without this, editing the sequences file would change conclusions while the seal still passed. */
export const sequencesChecksum = (sequences: Record<string, string>, referenceSequence?: string): string =>
  `sha256:${sha256Hex(canonicalJson({ referenceSequence: referenceSequence ?? null, sequences }))}`

/** Checks a panel and its sequences against the seal. Returns what's wrong; repairs nothing. */
export function verifyBundle({ panel, sequences, referenceSequence }: PanelBundle): Diagnostic[] {
  const out: Diagnostic[] = []
  if (!panel.checksum || !verifyPanel(panel)) out.push({ severity: 'error', code: 'checksum-mismatch', message: 'The panel changed after it was sealed' })
  if (panel.sequencesChecksum !== sequencesChecksum(sequences, referenceSequence)) out.push({ severity: 'error', code: 'sequences-changed', message: "The panel's sequences aren't the ones it was sealed with" })
  if (out.length) return out
  const derived = deriveEvaluation({
    length: panel.reference.length, windows: panel.windows, rules: panel.rules,
    groups: panel.groups.map((g) => ({ id: g.id, records: g.evidence.filter((e) => e.use === 'lineage-and-location').map((e) => ({ aligned: sequences[e.record] ?? '', block: e.block })) })),
  })
  const stored = { coverage: Object.fromEntries(panel.groups.map((g) => [g.id, g.coverage])), pairs: panel.pairs }
  if (canonicalJson(stored) !== canonicalJson(derived)) out.push({ severity: 'error', code: 'derivation-mismatch', message: "The panel's sites and coverage don't follow from its sequences and rules" })
  return out
}

/** Provenance that can support a statement about where a group occurs. Assigned-by-sequence classes can't. */
export const LOCATION_EVIDENCE: readonly ProvenanceClass[] = ['wild-documented', 'museum-documented', 'origin-reported']

function coordinateKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => coordinateKeys(v, `${path}.${i}`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
    ...(/^(lat|lon|lng|latitude|longitude|latlon|lat_lon|coordinates?)$/i.test(k) ? [`${path}.${k}`] : []),
    ...coordinateKeys(v, `${path}.${k}`),
  ])
}

/** Explains problems with a panel and repairs nothing. Errors mean it can't be activated. */
export function validatePanel(panel: Panel): Diagnostic[] {
  const out: Diagnostic[] = []
  const error = (code: string, message: string, path?: string) => out.push({ severity: 'error', code, message, ...(path ? { path } : {}) })
  if (panel.schemaVersion !== 2) error('schema-version', `Unknown schema version ${String(panel.schemaVersion)}`)
  if (!panel.taxa.length) error('no-taxa', 'A panel needs at least one taxon', 'taxa')
  if (!panel.rules) error('no-rules', 'A panel must state the rules it is read with', 'rules')
  if (!panel.gates) error('no-gates', 'A panel must state the record checks its members passed', 'gates')
  if (!panel.groups.length) error('no-groups', 'A panel needs at least one group', 'groups')
  for (const [i, g] of panel.groups.entries())
    for (const e of g.ecoregions ?? []) if (!Number.isInteger(e) || e < 1 || e > 9999) error('bad-ecoregion', `Group ${g.id} names ecoregion ${String(e)}, which isn't a RESOLVE Ecoregions 2017 ID`, `groups.${i}.ecoregions`)
  for (const [i, c] of (panel.claims ?? []).entries())
    if (!panel.groups.some((g) => g.id === c.a) || !panel.groups.some((g) => g.id === c.b) || !panel.windows?.some((w) => w.id === c.window)) error('unknown-claim', `A validated claim names ${c.a}, ${c.b} or ${c.window}, which isn't in this panel`, `claims.${i}`)
  if (!panel.windows?.length) error('no-windows', 'A panel needs at least one window', 'windows')
  for (const [w, window] of (panel.windows ?? []).entries())
    if (window.start < 0 || window.end <= window.start || window.end > panel.reference.length)
      error('window-range', `Window ${window.id} (${window.start}-${window.end}) is outside the reference (length ${panel.reference.length})`, `windows.${w}`)
  for (const [i, pair] of (panel.pairs ?? []).entries()) {
    const window = panel.windows?.find((w) => w.id === pair.window)
    for (const site of pair.sites) if (!window || site.position < window.start || site.position >= window.end) error('site-outside-window', `Site ${site.position} is outside window ${pair.window}`, `pairs.${i}`)
  }
  const seen = new Set<string>()
  for (const [g, group] of panel.groups.entries()) {
    if (seen.has(group.id)) error('duplicate-group', `Group id ${group.id} is used twice`, `groups.${g}.id`)
    seen.add(group.id)
    if (!group.evidence.some((e) => e.use === 'lineage-and-location')) error('no-location-evidence', `Group ${group.id} has no record that can show where it occurs`, `groups.${g}.evidence`)
    else if (group.coverage.every((c) => !c.columnsAtDepth.length)) out.push({ severity: 'warning', code: 'group-not-evaluable', message: `Group ${group.id} has too few records to be compared in any window, so results can only report it as not evaluable`, path: `groups.${g}.coverage` })
    for (const [e, item] of group.evidence.entries())
      if (item.use === 'lineage-and-location' && !LOCATION_EVIDENCE.includes(item.provenanceClass))
        error('invalid-location-evidence', `Record ${item.record} is ${item.provenanceClass}, so it can't show where a group occurs`, `groups.${g}.evidence.${e}`)
      else if (item.provenanceClass === 'origin-reported' && !item.originSource)
        error('origin-source-missing', `Record ${item.record} is origin-reported, but names no source for that origin`, `groups.${g}.evidence.${e}`)
  }
  for (const path of coordinateKeys(panel)) error('coordinates-in-panel', 'Panels use generalized regions and never hold coordinates', path.slice(1))
  if (panel.status !== 'candidate') {
    if (!panel.checksum) error('unsealed', 'Only a sealed panel can leave candidate status', 'checksum')
    else if (!verifyPanel(panel)) error('checksum-mismatch', 'The panel changed after it was sealed', 'checksum')
  }
  if (!panel.notCovered.length) out.push({ severity: 'warning', code: 'coverage-not-stated', message: 'The panel states nothing about what it does not cover', path: 'notCovered' })
  if (!panel.validatedScope.length) out.push({ severity: 'warning', code: 'not-validated', message: 'The panel has no validated scope yet', path: 'validatedScope' })
  return out
}

/** Checks that a result keeps its honesty rules, including against its panel when one is given. */
export function validateResult(result: Result, panel?: Panel): Diagnostic[] {
  const out: Diagnostic[] = []
  const error = (code: string, message: string, path?: string) => out.push({ severity: 'error', code, message, ...(path ? { path } : {}) })
  if (!result.panel.id || !result.panel.version || !result.panel.checksum) error('unscoped-result', 'A result must name an exact panel version and checksum', 'panel')
  for (const [i, finding] of result.findings.entries()) {
    const path = `findings.${i}`
    if (finding.overlap === 0 && finding.status !== 'not_evaluable') error('no-shared-sites', `Group ${finding.group} shares no sites, so its status must be not_evaluable`, path)
    if (!finding.reason.trim()) error('finding-without-reason', `The finding for ${finding.group} gives no reason`, path)
    // A group can't be ruled out by anything except a resolved pair. No coverage, no bridge and no distance can do it.
    if (finding.status === 'excluded_within_panel' && !result.pairs.some((p) => p.state === 'resolved' && p.favors !== finding.group && (p.a === finding.group || p.b === finding.group)))
      error('exclusion-without-pair', `Group ${finding.group} is excluded, but no resolved pair rules it out`, path)
  }
  if (panel) {
    if (panel.id !== result.panel.id || panel.version !== result.panel.version || panel.checksum !== result.panel.checksum)
      error('wrong-panel', 'This result was not made with this panel version', 'panel')
    const found = new Set(result.findings.map((f) => f.group))
    for (const group of panel.groups) if (!found.has(group.id)) error('missing-group', `Group ${group.id} has no finding: every group must be reported`, 'findings')
    const groups = new Set(panel.groups.map((g) => g.id))
    for (const f of result.findings) if (!groups.has(f.group)) error('unknown-group', `Group ${f.group} is not in this panel`, 'findings')
  }
  return out
}
