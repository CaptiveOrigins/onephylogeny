import { compareAligned, coverage, isMissing } from './sequence.js'
import { sealPanel } from './panel.js'
import type { Diagnostic, EvaluationThresholds, Finding, Panel, PanelGroup, PanelSettings, ProvenanceClass, Result, EvidenceUse } from './model.js'

/** A panel and the aligned sequences its evidence names. Panels stay JSON; sequences travel in FASTA beside them. */
export type PanelBundle = { panel: Panel; sequences: Record<string, string>; referenceSequence?: string }

export type PanelMember = { record: string; group: string; aligned: string; provenanceClass: ProvenanceClass; use?: EvidenceUse }

export type BuildPanelInput = {
  settings: PanelSettings
  taxa: Panel['taxa']
  marker: Panel['marker']
  reference: Panel['reference']
  sources: Panel['sources']
  builtBy: string
  members: PanelMember[]
  referenceSequence?: string
}

const LOCATION: readonly ProvenanceClass[] = ['wild-documented', 'museum-documented']

function basesAt(members: PanelMember[], position: number): Set<string> {
  const out = new Set<string>()
  for (const m of members) {
    const c = m.aligned[position]?.toUpperCase()
    if (c === 'A' || c === 'C' || c === 'G' || c === 'T') out.add(c)
  }
  return out
}

/** Builds a sealed panel: evaluable windows from real coverage, and sites fixed against every other group. */
export function buildPanel(input: BuildPanelInput): PanelBundle {
  const { settings, members } = input
  const length = input.reference.length
  const groups: PanelGroup[] = settings.groups.map((g) => {
    const own = members.filter((m) => m.group === g.id)
    const others = members.filter((m) => m.group !== g.id)
    const windows: PanelGroup['windows'] = []
    let start = -1
    for (let i = 0; i <= length; i++) {
      const covered = i < length && own.some((m) => !isMissing(m.aligned[i]?.toUpperCase()))
      if (covered && start < 0) start = i
      if (!covered && start >= 0) {
        const diagnosticSites: PanelGroup['windows'][number]['diagnosticSites'] = []
        for (let p = start; p < i; p++) {
          const a = basesAt(own, p)
          const b = basesAt(others, p)
          if (a.size && b.size && ![...a].some((x) => b.has(x))) diagnosticSites.push({ position: p, bases: [...a].sort().join('') })
        }
        windows.push({ start, end: i, diagnosticSites })
        start = -1
      }
    }
    return {
      id: g.id,
      label: g.label,
      ...(g.region ? { region: g.region } : {}),
      windows,
      evidence: own.map((m) => ({ record: m.record, use: m.use ?? (LOCATION.includes(m.provenanceClass) ? 'lineage-and-location' : 'lineage-only'), provenanceClass: m.provenanceClass })),
    }
  })
  const panel = sealPanel({
    schemaVersion: 1,
    id: settings.id,
    version: settings.version,
    status: 'candidate',
    taxa: input.taxa,
    marker: input.marker,
    reference: input.reference,
    groups,
    notCovered: settings.notCovered,
    validatedScope: settings.validatedScope,
    sources: input.sources,
    builtBy: input.builtBy,
  })
  return { panel, sequences: Object.fromEntries(members.map((m) => [m.record, m.aligned])), ...(input.referenceSequence ? { referenceSequence: input.referenceSequence } : {}) }
}

/** How far members of a group sit from their nearest groupmate, over a shared minimum overlap. */
function groupSpread(group: PanelGroup, sequences: Record<string, string>, minOverlap: number): number {
  const seqs = [...new Set(group.evidence.map((e) => sequences[e.record]).filter((s): s is string => Boolean(s)))]
  let spread = 0
  for (const a of seqs) {
    let nearest = Infinity
    for (const b of seqs) {
      if (a === b) continue
      const c = compareAligned(a, b)
      if (c.overlap >= minOverlap && c.differences < nearest) nearest = c.differences
    }
    if (nearest !== Infinity && nearest > spread) spread = nearest
  }
  return spread
}

export type EvaluateOptions = { thresholds: EvaluationThresholds; queryId: string; runId: string; caveats?: string[] }

/**
 * Tests one query against every group of a panel. Every group gets a finding with its reason. Statuses come from
 * shared sites, nearest differences and fixed sites, using stated thresholds; none of this is a probability.
 */
export function evaluateQuery(queryAligned: string, bundle: PanelBundle, options: EvaluateOptions): Result {
  const { panel, sequences } = bundle
  const { minOverlap, tolerance, minDiagnosticConflicts } = options.thresholds
  const span = coverage(queryAligned)
  const findings: Finding[] = panel.groups.map((group) => {
    let overlap = 0
    let nearest = Infinity
    let nearestRate = Infinity
    let nearestRecords: string[] = []
    for (const e of group.evidence) {
      const seq = sequences[e.record]
      if (!seq) continue
      const c = compareAligned(queryAligned, seq)
      if (c.overlap > overlap) overlap = c.overlap
      if (c.overlap < minOverlap) continue
      if (c.differences < nearest) { nearest = c.differences; nearestRate = c.pDistance ?? Infinity; nearestRecords = [e.record] }
      else if (c.differences === nearest) nearestRecords.push(e.record)
    }
    if (nearest === Infinity) {
      return { group: group.id, status: 'not_evaluable', reason: `Shares ${overlap} sites at most, below the minimum of ${minOverlap}`, overlap, evidence: [] }
    }
    let agree = 0
    let conflict = 0
    for (const window of group.windows) {
      for (const site of window.diagnosticSites) {
        const base = queryAligned[site.position]?.toUpperCase()
        if (base !== 'A' && base !== 'C' && base !== 'G' && base !== 'T') continue
        if (site.bases.includes(base)) agree++
        else conflict++
      }
    }
    const allowed = groupSpread(group, sequences, minOverlap) + tolerance
    const evidence = nearestRecords.slice(0, 5)
    const detail = `${nearest} differences from the nearest record over up to ${overlap} sites; ${agree} fixed sites agree and ${conflict} conflict`
    if (nearest <= allowed && conflict < minDiagnosticConflicts) return { group: group.id, status: 'consistent', reason: `Within this group's spread (${allowed} allowed): ${detail}`, overlap, differences: nearest, distance: nearestRate, evidence }
    if (nearest > allowed && conflict >= minDiagnosticConflicts) return { group: group.id, status: 'excluded_within_panel', reason: `Outside this group's spread (${allowed} allowed): ${detail}`, overlap, differences: nearest, distance: nearestRate, evidence }
    return { group: group.id, status: 'inconclusive', reason: `Signals disagree (${allowed} allowed): ${detail}`, overlap, differences: nearest, distance: nearestRate, evidence }
  })
  const evaluable = findings.filter((f) => f.status !== 'not_evaluable')
  if (evaluable.length && !findings.some((f) => f.status === 'consistent')) {
    const closest = evaluable.reduce((a, b) => ((a.distance ?? Infinity) <= (b.distance ?? Infinity) ? a : b))
    closest.status = 'novel_or_unsampled_flag'
    closest.reason = `No group is consistent. This is the closest, which may mean an unsampled population: ${closest.reason}`
  }
  const caveats = [...(options.caveats ?? [])]
  for (const f of findings) if (f.status === 'not_evaluable') caveats.push(`${f.group} could not be evaluated, so this result says nothing about it`)
  if (panel.notCovered.length) caveats.push(`This panel does not cover: ${panel.notCovered.join(', ')}`)
  return {
    schemaVersion: 1,
    query: options.queryId,
    panel: { id: panel.id, version: panel.version, checksum: panel.checksum! },
    run: options.runId,
    overlap: span?.bases ?? 0,
    findings,
    caveats,
  }
}

export type GroupScore = { group: string; tested: number; includedTruth: number; onlyTruth: number; excludedTruth: number; notEvaluable: number; meanConsistent: number }

export type ValidationReport = {
  scheme: 'leave-one-block-out' | 'leave-one-group-out'
  tested: number
  skipped: number
  groups: GroupScore[]
  /** For leave-one-group-out: tests where a group was consistent even though the true group was absent. */
  falseConsistent?: number
  diagnostics: Diagnostic[]
}

export type ValidationInput = Omit<BuildPanelInput, 'members'> & { members: (PanelMember & { block?: string })[] }

/** Tests each block of records against a panel rebuilt without it, so a record never meets its own site. */
export function leaveOneBlockOut(input: ValidationInput): ValidationReport {
  const thresholds = input.settings.thresholds
  const blocks = new Map<string, ValidationInput['members']>()
  for (const m of input.members) {
    const key = m.block ?? `record:${m.record}`
    const list = blocks.get(key)
    if (list) list.push(m)
    else blocks.set(key, [m])
  }
  const scores = new Map<string, GroupScore>()
  const score = (g: string) => {
    let s = scores.get(g)
    if (!s) { s = { group: g, tested: 0, includedTruth: 0, onlyTruth: 0, excludedTruth: 0, notEvaluable: 0, meanConsistent: 0 }; scores.set(g, s) }
    return s
  }
  let tested = 0
  let skipped = 0
  for (const [, held] of blocks) {
    const rest = input.members.filter((m) => !held.includes(m))
    const bundle = buildPanel({ ...input, members: rest })
    for (const m of held) {
      if (!rest.some((r) => r.group === m.group)) { skipped++; continue }
      const result = evaluateQuery(m.aligned, bundle, { thresholds, queryId: m.record, runId: 'validation' })
      const s = score(m.group)
      tested++
      s.tested++
      const finding = result.findings.find((f) => f.group === m.group)
      const consistent = result.findings.filter((f) => f.status === 'consistent').map((f) => f.group)
      s.meanConsistent += consistent.length
      if (finding?.status === 'not_evaluable') s.notEvaluable++
      else if (finding?.status === 'excluded_within_panel') s.excludedTruth++
      if (consistent.includes(m.group)) {
        s.includedTruth++
        if (consistent.length === 1) s.onlyTruth++
      }
    }
  }
  const groups = [...scores.values()].map((s) => ({ ...s, meanConsistent: s.tested ? s.meanConsistent / s.tested : 0 }))
  return { scheme: 'leave-one-block-out', tested, skipped, groups, diagnostics: [] }
}

/** Removes each whole group and tests its members. Success means no remaining group claims them. */
export function leaveOneGroupOut(input: ValidationInput): ValidationReport {
  const thresholds = input.settings.thresholds
  let tested = 0
  let falseConsistent = 0
  const groups: GroupScore[] = []
  for (const g of input.settings.groups) {
    const held = input.members.filter((m) => m.group === g.id)
    const settings = { ...input.settings, groups: input.settings.groups.filter((x) => x.id !== g.id) }
    const bundle = buildPanel({ ...input, settings, members: input.members.filter((m) => m.group !== g.id) })
    const s: GroupScore = { group: g.id, tested: 0, includedTruth: 0, onlyTruth: 0, excludedTruth: 0, notEvaluable: 0, meanConsistent: 0 }
    for (const m of held) {
      const result = evaluateQuery(m.aligned, bundle, { thresholds, queryId: m.record, runId: 'validation' })
      const consistent = result.findings.filter((f) => f.status === 'consistent').length
      tested++
      s.tested++
      s.meanConsistent += consistent
      if (consistent) falseConsistent++
      if (result.findings.every((f) => f.status === 'not_evaluable')) s.notEvaluable++
    }
    groups.push({ ...s, meanConsistent: s.tested ? s.meanConsistent / s.tested : 0 })
  }
  return { scheme: 'leave-one-group-out', tested, skipped: 0, groups, falseConsistent, diagnostics: [] }
}
