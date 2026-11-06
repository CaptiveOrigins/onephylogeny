import { basesOf, compareAligned, coverage } from './sequence.js'
import { deriveEvaluation, wholeMarker } from './derive.js'
import { DEFAULT_GATES, type GateSettings } from './gates.js'
import { LOCATION_EVIDENCE, sealPanel, sequencesChecksum } from './panel.js'
import type { Diagnostic, Finding, FindingReason, FindingWindow, Id, Novelty, PairFinding, PairReason, Panel, PanelGroup, PanelSettings, ProvenanceClass, Result, EvidenceUse, ValidatedClaim, StudyLink } from './model.js'
import { CLAIM_GATES, clopperPearson, describeClaim } from './validation.js'

/** A panel and the aligned sequences its evidence names. Panels stay JSON; sequences travel in FASTA beside them. */
export type PanelBundle = { panel: Panel; sequences: Record<string, string>; referenceSequence?: string }

export type PanelMember = { record: string; group: string; aligned: string; provenanceClass: ProvenanceClass; use?: EvidenceUse; originSource?: string; block?: string; study?: string }

export type BuildPanelInput = {
  settings: PanelSettings
  taxa: Panel['taxa']
  marker: Panel['marker']
  reference: Panel['reference']
  sources: Panel['sources']
  builtBy: string
  members: PanelMember[]
  referenceSequence?: string
  builtWith?: { name: string; version: string }[]
  /** The record checks these members passed. */
  gates?: GateSettings
  /** Nuclear copies from a genome screen, sealed into the panel. */
  numtCopies?: { id: string; aligned: string }[]
  study?: StudyLink
  /** Claims that passed validation. Only these reach a panel's scope, whatever the settings say. */
  claims?: ValidatedClaim[]
}

export const useOf = (m: Pick<PanelMember, 'use' | 'provenanceClass'>): EvidenceUse => m.use ?? (LOCATION_EVIDENCE.includes(m.provenanceClass) ? 'lineage-and-location' : 'lineage-only')
export const locates = (m: Pick<PanelMember, 'use' | 'provenanceClass'>) => useOf(m) === 'lineage-and-location'

/**
 * Builds a sealed panel: coverage per group and sites per pair of groups, in named windows. Only records that can show
 * where a group occurs shape these. A record assigned to a group by its own sequence stays listed, but counting it would
 * make the group's definition depend on the answer being tested.
 */
export function buildPanel(input: BuildPanelInput): PanelBundle {
  const bundle = unsealedBundle(input)
  const panel = sealPanel({ ...bundle.panel, sequencesChecksum: sequencesChecksum(bundle.sequences, input.referenceSequence) })
  return { ...bundle, panel }
}

/** The same panel without hashing, for validation, which builds thousands and never keeps one. */
export function unsealedBundle(input: BuildPanelInput): PanelBundle {
  const { settings } = input
  const length = input.reference.length
  const windows = settings.windows?.length ? settings.windows : wholeMarker(length)
  // Opaque, so a distributed panel doesn't name its sampling sites.
  const blockNames = new Map([...new Set(input.members.flatMap((m) => (m.block ? [m.block] : [])))].sort().map((b, i) => [b, `block-${i + 1}`]))
  const block = (m: PanelMember) => (m.block ? blockNames.get(m.block) : undefined)
  const derived = deriveEvaluation({
    length, windows, rules: settings.rules,
    groups: settings.groups.map((g) => ({ id: g.id, records: input.members.filter((m) => m.group === g.id && locates(m)).map((m) => ({ aligned: m.aligned, block: block(m) })) })),
  })
  const groups: PanelGroup[] = settings.groups.map((g) => {
    return {
      id: g.id,
      label: g.label,
      ...(g.region ? { region: g.region } : {}),
      coverage: derived.coverage[g.id]!,
      evidence: input.members.filter((m) => m.group === g.id).map((m) => {
        const b = block(m)
        return { record: m.record, use: useOf(m), provenanceClass: m.provenanceClass, ...(m.originSource ? { originSource: m.originSource } : {}), ...(b ? { block: b } : {}), ...(m.study ? { study: m.study } : {}) }
      }),
    }
  })
  const sequences = Object.fromEntries(input.members.map((m) => [m.record, m.aligned]))
  const claims = input.claims ?? []
  const panel: Panel = {
    schemaVersion: 2,
    id: settings.id,
    version: settings.version,
    status: 'candidate',
    taxa: input.taxa,
    marker: input.marker,
    reference: input.reference,
    windows,
    groups,
    pairs: derived.pairs,
    notCovered: settings.notCovered,
    validatedScope: claims.map(describeClaim),
    claims,
    sources: input.sources,
    builtBy: input.builtBy,
    rules: settings.rules,
    gates: input.gates ?? DEFAULT_GATES,
    sequencesChecksum: '',
    ...(input.builtWith ? { builtWith: input.builtWith } : {}),
    ...(input.numtCopies?.length ? { numtCopies: input.numtCopies } : {}),
    ...(input.study ? { study: input.study } : {}),
  }
  return { panel, sequences, ...(input.referenceSequence ? { referenceSequence: input.referenceSequence } : {}) }
}

export type EvaluateOptions = { queryId: string; runId: string; caveats?: string[]; querySha256?: string; producedBy?: { name: string; version: string }[] }

type GroupEvaluation = { finding: Finding; windows: Set<string> }

/** Can this group be compared with this query at all, and how near is it? Says nothing yet about other groups. */
function compareWithGroup(query: string, group: PanelGroup, bundle: PanelBundle): GroupEvaluation {
  const { panel, sequences } = bundle
  const { minSharedColumns, tolerance } = panel.rules
  const usable = group.evidence.filter(locates)
  const notEvaluable = (reasonCode: FindingReason, reason: string, overlap = 0, recordsNeeded?: number): GroupEvaluation => ({
    finding: { group: group.id, status: 'not_evaluable', reasonCode, reason, overlap, informativeSites: 0, windows: [], evidence: [], ...(recordsNeeded ? { recordsNeeded } : {}) }, windows: new Set(),
  })
  if (!usable.length) return notEvaluable('no-location-evidence', 'This group has no record that can show where it occurs')
  const windows: FindingWindow[] = []
  let bestShared = 0
  let needed = 0
  let differences = 0
  let compared = 0
  let unresolved = 0
  let queryHasWindow = false
  for (const cov of group.coverage) {
    const window = panel.windows.find((w) => w.id === cov.window)!
    let inWindow = 0
    for (let i = window.start; i < window.end; i++) if (basesOf(query[i])) inWindow++
    if (inWindow >= minSharedColumns) {
      queryHasWindow = true
      needed = Math.max(needed, cov.recordsNeeded)
    }
    let shared = 0
    for (const [s, e] of cov.columnsAtDepth) for (let i = s; i < e; i++) if (basesOf(query[i])) shared++
    if (shared > bestShared) bestShared = shared
    if (shared < minSharedColumns) continue
    let nearest = Infinity
    let best: { differences: number; overlap: number; unresolved: number } | null = null
    let records: string[] = []
    for (const e of usable) {
      const seq = sequences[e.record]
      if (!seq) continue
      const c = compareAligned(query, seq, window)
      if (c.overlap < minSharedColumns || c.pDistance === null) continue
      if (c.pDistance < nearest) { nearest = c.pDistance; best = c; records = [e.record] }
      else if (c.pDistance === nearest) records.push(e.record)
    }
    if (!best) continue
    const allowedDifferences = Math.ceil((cov.spreadRate ?? 0) * best.overlap) + tolerance
    windows.push({ window: cov.window, sharedColumns: shared, differences: best.differences, unresolved: best.unresolved, allowedDifferences, nearest: records.slice(0, 5) })
    differences += best.differences
    compared += best.overlap
    unresolved += best.unresolved
  }
  if (!windows.length) {
    if (queryHasWindow && needed > 0) return notEvaluable('too-few-records', `Needs ${needed} more records before these columns can be compared`, bestShared, needed)
    return notEvaluable('too-few-shared-columns', `Shares ${bestShared} well-covered columns at most, below the minimum of ${minSharedColumns}`, bestShared)
  }
  const blockCount = group.coverage.filter((c) => windows.some((w) => w.window === c.window)).reduce((n, c) => Math.max(n, c.blocks), 0)
  return {
    windows: new Set(windows.map((w) => w.window)),
    finding: {
      group: group.id, status: 'inconclusive', reasonCode: 'outside-spread-not-contradicted', reason: '',
      overlap: windows.reduce((n, w) => n + w.sharedColumns, 0), unresolved, differences, distance: compared ? differences / compared : 0,
      informativeSites: 0, blocks: blockCount, windows, evidence: [...new Set(windows.flatMap((w) => w.nearest))].slice(0, 5),
    },
  }
}

/** Do the columns this query covers separate these two groups? */
function comparePair(query: string, a: Id, b: Id, evaluated: Map<Id, GroupEvaluation>, panel: Panel): { pair: PairFinding; covered: Set<number> } {
  const { minDecisiveSites, minBlocksForExclusion } = panel.rules
  const [ea, eb] = [evaluated.get(a)!, evaluated.get(b)!]
  const windows = panel.pairs.filter((p) => p.a === a && p.b === b && ea.windows.has(p.window) && eb.windows.has(p.window))
  const tally = { sitesCovered: 0, forA: 0, forB: 0, neither: 0, ambiguous: 0 }
  const covered = new Set<number>()
  if (!windows.length) return { pair: { a, b, state: 'not_evaluable', reasonCode: 'group-not-evaluable', ...tally }, covered }
  // Conflicts that count against a side: only where that side has enough independent sites to be ruled out.
  let strongAgainstA = 0
  let strongAgainstB = 0
  for (const site of windows.flatMap((p) => p.sites)) {
    const possible = basesOf(query[site.position])
    if (!possible) continue
    covered.add(site.position)
    tally.sitesCovered++
    if (possible.length > 1) { tally.ambiguous++; continue }
    if (site.a.includes(possible)) {
      tally.forA++
      if (site.blocks.b >= minBlocksForExclusion) strongAgainstB++
    } else if (site.b.includes(possible)) {
      tally.forB++
      if (site.blocks.a >= minBlocksForExclusion) strongAgainstA++
    } else tally.neither++
  }
  const unresolved = (reasonCode: PairReason): { pair: PairFinding; covered: Set<number> } => ({ pair: { a, b, state: 'not_resolved', reasonCode, ...tally }, covered })
  if (!tally.sitesCovered) return unresolved('no-sites-covered')
  if (tally.forA && tally.forB) return unresolved('sites-disagree')
  const [lead, strong] = tally.forA ? [tally.forA, strongAgainstB] : [tally.forB, strongAgainstA]
  if (lead < minDecisiveSites) return unresolved('too-few-decisive-sites')
  if (strong < minDecisiveSites) return unresolved('thin-group')
  return { pair: { a, b, state: 'resolved', reasonCode: 'decisive-sites', favors: tally.forA ? a : b, ...tally }, covered }
}

/**
 * Asks three things separately: can each group be compared, do the columns this query covers separate each pair, and does
 * anything rule a group out. Statuses come from stated rules, and none of this is a probability.
 */
export function evaluateQuery(queryAligned: string, bundle: PanelBundle, options: EvaluateOptions): Result {
  const { panel } = bundle
  const span = coverage(queryAligned)
  const evaluated = new Map(panel.groups.map((g) => [g.id, compareWithGroup(queryAligned, g, bundle)]))
  const pairs: PairFinding[] = []
  const contradictedBy = new Map<Id, Id[]>()
  const informative = new Map<Id, Set<number>>(panel.groups.map((g) => [g.id, new Set<number>()]))
  for (let x = 0; x < panel.groups.length; x++) {
    for (let y = x + 1; y < panel.groups.length; y++) {
      const [a, b] = [panel.groups[x]!.id, panel.groups[y]!.id]
      const { pair, covered } = comparePair(queryAligned, a, b, evaluated, panel)
      pairs.push(pair)
      for (const p of covered) { informative.get(a)!.add(p); informative.get(b)!.add(p) }
      if (pair.state === 'resolved') {
        const loser = pair.favors === a ? b : a
        contradictedBy.set(loser, [...(contradictedBy.get(loser) ?? []), pair.favors!])
      }
    }
  }
  const labelOf = (id: Id) => panel.groups.find((g) => g.id === id)?.label ?? id
  const findings = panel.groups.map((g): Finding => {
    const f = evaluated.get(g.id)!.finding
    if (f.status === 'not_evaluable') return f
    const within = f.windows.every((w) => w.differences <= w.allowedDifferences)
    const by = contradictedBy.get(g.id) ?? []
    const allowed = f.windows.map((w) => `${w.differences} of ${w.allowedDifferences} allowed over ${w.sharedColumns} columns in ${w.window}`).join('; ')
    const sites = informative.get(g.id)!.size
    const detail = `${allowed}; ${sites} separating sites covered`
    const base = { ...f, informativeSites: sites }
    if (within && !by.length) return { ...base, status: 'consistent', reasonCode: 'within-spread', reason: `Within this group's spread: ${detail}` }
    if (!within && by.length) return { ...base, status: 'excluded_within_panel', reasonCode: 'contradicted-outside-spread', reason: `Outside this group's spread, and decisive sites favor ${by.map(labelOf).join(', ')}: ${detail}` }
    if (by.length) return { ...base, status: 'inconclusive', reasonCode: 'contradicted-within-spread', reason: `Within this group's spread, yet decisive sites favor ${by.map(labelOf).join(', ')}: ${detail}` }
    return { ...base, status: 'inconclusive', reasonCode: 'outside-spread-not-contradicted', reason: `Outside this group's spread, but no decisive sites rule it out: ${detail}` }
  })
  const evaluable = findings.filter((f) => f.status !== 'not_evaluable')
  const neitherSideSites = new Set(panel.pairs.flatMap((p) => p.sites).filter((s) => {
    const possible = basesOf(queryAligned[s.position])
    return possible?.length === 1 && !s.a.includes(possible) && !s.b.includes(possible)
  }).map((s) => s.position)).size
  const noFit = evaluable.length > 0 && !evaluable.some((f) => f.status === 'consistent')
  const reasons: Novelty['reasons'] = [...(noFit ? ['no-consistent-group' as const] : []), ...(neitherSideSites ? ['base-matching-neither-side' as const] : [])]
  const closest = noFit ? evaluable.reduce((a, b) => ((a.distance ?? Infinity) <= (b.distance ?? Infinity) ? a : b)).group : undefined
  const candidatesNotEvaluated = findings.filter((f) => f.status === 'not_evaluable').map((f) => f.group)
  const caveats = [...(options.caveats ?? [])]
  for (const f of findings) if (f.status === 'not_evaluable') caveats.push(`${labelOf(f.group)} could not be evaluated, so this result says nothing about it`)
  if (panel.notCovered.length) caveats.push(`This panel does not cover: ${panel.notCovered.join(', ')}`)
  caveats.push('A match means this sequence resembles the records in a group. It doesn\'t show the animal came from that group\'s region, because a lineage can reach beyond the places sampled so far')
  const outOfValidatedScope = [
    ...(panel.status === 'active' ? [] : [`This panel is ${panel.status}, not active`]),
    ...(panel.claims.length ? [] : ['This panel has no validated claims yet']),
  ]
  if (panel.claims.length) {
    for (const p of pairs.filter((x) => x.state === 'resolved')) {
      const covers = panel.claims.some((c) => {
        if (c.a !== p.a || c.b !== p.b) return false
        const w = panel.windows.find((x) => x.id === c.window)
        return Boolean(w) && [...queryAligned.slice(w!.start, w!.end)].filter((x) => basesOf(x)).length >= c.minColumns
      })
      if (!covers) outOfValidatedScope.push(`${labelOf(p.a)} vs ${labelOf(p.b)} isn't a validated claim for this much sequence`)
    }
    if (!pairs.some((p) => p.state === 'resolved')) outOfValidatedScope.push('This sequence resolves none of the validated claims')
  }
  return {
    schemaVersion: 2,
    query: options.queryId,
    ...(options.querySha256 ? { querySha256: options.querySha256 } : {}),
    ...(options.producedBy ? { producedBy: options.producedBy } : {}),
    panel: { id: panel.id, version: panel.version, checksum: panel.checksum! },
    run: options.runId,
    overlap: span?.bases ?? 0,
    findings,
    pairs,
    candidatesNotEvaluated,
    novelty: { flagged: noFit, reasons, ...(closest ? { closest } : {}), neitherSideSites },
    outOfValidatedScope,
    caveats,
  }
}

/**
 * How each test's true group came out. `includedTruth + excludedTruth + inconclusive + notEvaluable` equals `tested`.
 * `flagged` overlaps those: it counts tests where the query itself was flagged as possibly novel. `onlyTruthAllEvaluated`
 * is the stricter `onlyTruth`: every other group could be compared too, so nothing unevaluated could be the real answer.
 */
export type GroupScore = { group: string; tested: number; includedTruth: number; onlyTruth: number; onlyTruthAllEvaluated: number; excludedTruth: number; inconclusive: number; flagged: number; notEvaluable: number; meanConsistent: number }

/**
 * Sites beside records, for one group. `interval` is left out below 4 sites, where only counts can be honest. A site
 * counts as right only if all its records are.
 */
export type GroupSites = { group: string; records: number; sites: number; largestSiteShare: number; sitesRight: number; interval?: [number, number] }

export type ValidationReport = {
  scheme: 'leave-one-block-out' | 'leave-one-group-out' | 'leave-one-record-out' | 'leave-one-haplotype-out' | 'leave-one-study-out'
  tested: number
  skipped: number
  groups: GroupScore[]
  sites?: GroupSites[]
  /** Groups with no test at all, such as a group with one site. Absent from `groups`, which says nothing about them. */
  untestedGroups: string[]
  /** For leave-one-group-out: tests where a group was consistent even though the true group was absent. */
  falseConsistent?: number
  diagnostics: Diagnostic[]
}

export type ValidationInput = BuildPanelInput

/** Tests each held-out set of records against a panel rebuilt without it. */
export function holdOut(input: ValidationInput, keyOf: (m: PanelMember) => string, scheme: ValidationReport['scheme']): ValidationReport {
  const blocks = new Map<string, ValidationInput['members']>()
  for (const m of input.members) {
    const key = keyOf(m)
    const list = blocks.get(key)
    if (list) list.push(m)
    else blocks.set(key, [m])
  }
  const scores = new Map<string, GroupScore>()
  const score = (g: string) => {
    let s = scores.get(g)
    if (!s) { s = { group: g, tested: 0, includedTruth: 0, onlyTruth: 0, onlyTruthAllEvaluated: 0, excludedTruth: 0, inconclusive: 0, flagged: 0, notEvaluable: 0, meanConsistent: 0 }; scores.set(g, s) }
    return s
  }
  const perSite = new Map<string, { group: string; site: string; records: number; right: number }>()
  let tested = 0
  let skipped = 0
  for (const [, held] of blocks) {
    const rest = input.members.filter((m) => !held.includes(m))
    const bundle = unsealedBundle({ ...input, members: rest })
    for (const m of held.filter(locates)) {
      if (!rest.some((r) => r.group === m.group && locates(r))) { skipped++; continue }
      const result = evaluateQuery(m.aligned, bundle, { queryId: m.record, runId: 'validation' })
      const s = score(m.group)
      tested++
      s.tested++
      const finding = result.findings.find((f) => f.group === m.group)
      const consistent = result.findings.filter((f) => f.status === 'consistent').map((f) => f.group)
      s.meanConsistent += consistent.length
      if (finding?.status === 'not_evaluable') s.notEvaluable++
      else if (finding?.status === 'excluded_within_panel') s.excludedTruth++
      else if (finding?.status === 'inconclusive') s.inconclusive++
      if (result.novelty.flagged) s.flagged++
      const siteKey = `${m.group}\u0000${m.block ?? ''}`
      const site = perSite.get(siteKey) ?? { group: m.group, site: m.block ?? '', records: 0, right: 0 }
      site.records++
      if (consistent.includes(m.group)) {
        site.right++
        s.includedTruth++
        if (consistent.length === 1) {
          s.onlyTruth++
          if (!result.candidatesNotEvaluated.length) s.onlyTruthAllEvaluated++
        }
      }
      perSite.set(siteKey, site)
    }
  }
  const groups = [...scores.values()].map((s) => ({ ...s, meanConsistent: s.tested ? s.meanConsistent / s.tested : 0 }))
  const sites = groups.map((g): GroupSites => {
    const own = [...perSite.values()].filter((p) => p.group === g.group && p.site)
    const records = own.reduce((n, p) => n + p.records, 0)
    const sitesRight = own.filter((p) => p.right === p.records).length
    return { group: g.group, records, sites: own.length, largestSiteShare: records ? Math.max(...own.map((p) => p.records)) / records : 0, sitesRight, ...(own.length >= CLAIM_GATES.minSitesPerGroup ? { interval: clopperPearson(sitesRight, own.length) } : {}) }
  })
  const diagnostics: Diagnostic[] = []
  for (const s of sites) {
    if (s.sites < CLAIM_GATES.minSitesPerGroup) diagnostics.push({ severity: 'warning', code: 'too-few-blocks', message: `${s.group} has ${s.sites} sites, so this shows counts only`, ids: [s.group] })
    if (s.largestSiteShare > 0.5) diagnostics.push({ severity: 'warning', code: 'single-block-dominates', message: `One site holds ${Math.round(s.largestSiteShare * 100)}% of ${s.group}'s records`, ids: [s.group] })
  }
  diagnostics.push(...lineageOnlyNote(input))
  return { scheme, tested, skipped, groups, sites, untestedGroups: input.settings.groups.map((g) => g.id).filter((g) => !scores.has(g)), diagnostics }
}

/** Tests each sampling site against a panel rebuilt without it, so a record never meets its own site. */
export function leaveOneBlockOut(input: ValidationInput): ValidationReport {
  const report = holdOut(input, (m) => m.block ?? `record:${m.record}`, 'leave-one-block-out')
  const noSite = input.members.filter((m) => locates(m) && m.block === undefined).length
  if (noSite) report.diagnostics.unshift({ severity: 'warning', code: 'records-without-site', message: `${noSite} records have no site, so each was held out alone. They can be tested against records from their own site, which flatters these results` })
  return report
}

/** A label given from a record's own sequence can't be test truth: scoring it would be circular. */
function lineageOnlyNote(input: ValidationInput): Diagnostic[] {
  const n = input.members.filter((m) => !locates(m)).length
  return n ? [{ severity: 'info', code: 'lineage-only-not-tested', message: `${n} records can't show where a group occurs, so they were neither tested nor used as evidence` }] : []
}

/** Removes each whole group and tests its members. Success means no remaining group claims them. */
export function leaveOneGroupOut(input: ValidationInput): ValidationReport {
  let tested = 0
  let falseConsistent = 0
  const groups: GroupScore[] = []
  for (const g of input.settings.groups) {
    const held = input.members.filter((m) => m.group === g.id)
    const settings = { ...input.settings, groups: input.settings.groups.filter((x) => x.id !== g.id) }
    const bundle = unsealedBundle({ ...input, settings, members: input.members.filter((m) => m.group !== g.id) })
    const s: GroupScore = { group: g.id, tested: 0, includedTruth: 0, onlyTruth: 0, onlyTruthAllEvaluated: 0, excludedTruth: 0, inconclusive: 0, flagged: 0, notEvaluable: 0, meanConsistent: 0 }
    for (const m of held.filter(locates)) {
      const result = evaluateQuery(m.aligned, bundle, { queryId: m.record, runId: 'validation' })
      const consistent = result.findings.filter((f) => f.status === 'consistent').length
      tested++
      s.tested++
      s.meanConsistent += consistent
      if (consistent) falseConsistent++
      if (result.findings.every((f) => f.status === 'not_evaluable')) s.notEvaluable++
    }
    groups.push({ ...s, meanConsistent: s.tested ? s.meanConsistent / s.tested : 0 })
  }
  const noEvidence = groups.reduce((sum, g) => sum + g.notEvaluable, 0)
  const diagnostics: Diagnostic[] = noEvidence ? [{ severity: 'info', code: 'not-evaluable-counted-separately', message: `${noEvidence} of these records could not be compared with any remaining group, so they say nothing about false claims` }] : []
  diagnostics.push(...lineageOnlyNote(input))
  return { scheme: 'leave-one-group-out', tested, skipped: 0, groups, untestedGroups: [], falseConsistent, diagnostics }
}
