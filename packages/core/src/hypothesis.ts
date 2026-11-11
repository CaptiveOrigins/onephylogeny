import type { PanelBundle } from './build.js'
import type { Diagnostic, Finding, Id, PanelPair, Result } from './model.js'
import { DISTANCE_NOVELTY_RULE, UNCALIBRATED_NOTE, noveltyByDistance, type DistanceNoveltyWindow } from './novelty.js'
import { canonicalJson, validateResult, verifyBundle } from './panel.js'
import { sha256Hex } from './sha256.js'

/**
 * Hypothesis chat, deterministic core (roadmap stage 9, ADR 0013). A person states a claim in a fixed form. The core says
 * which test it will run, on which saved artifacts and by which rule, before running it; then runs it on those artifacts
 * only and returns one verdict from a closed list, with the findings it rests on. It never builds, fetches or writes,
 * and it never calls a language model. Nothing here is a probability, and `not refuted` never means confirmed.
 */

/** The closed list. There is no `confirmed`: a test can fail to refute a claim, never prove it. */
export const HYPOTHESIS_VERDICTS = ['refuted', 'not refuted', 'untestable with this data', 'tool or data problem'] as const
export type HypothesisVerdictName = (typeof HYPOTHESIS_VERDICTS)[number]

/** A panel version by id and version, as results name it. */
export type PanelVersion = { id: Id; version: string }

export type HypothesisClaim =
  /** "Sample X belongs to group G." Read from the saved result of X against one panel version. */
  | { kind: 'sample-in-group'; sample: Id; group: Id; panel?: PanelVersion }
  /** "Group G is distinct from group H in window W": at least one fixed site separates them there, under the panel's rules. */
  | { kind: 'groups-distinct'; a: Id; b: Id; window: Id; panel?: PanelVersion }
  /** "Panel version B changed the call for record R": some group's finding status differs between R's results against A and B. */
  | { kind: 'panel-changed-call'; sample: Id; from: PanelVersion; to: PanelVersion; group?: Id }
  /** "This sample is possibly novel", by the uncalibrated distance rule (analysis protocol section 8). */
  | { kind: 'possibly-novel'; sample: Id; panel?: PanelVersion }

export type HypothesisClaimKind = HypothesisClaim['kind']

/** Where a saved artifact lives, as the engine names it (`type` and content `key`). Core never opens a store itself. */
export type ArtifactPointer = { type: string; key: string }

/**
 * A panel the caller loaded. `filesVerified` is the store's own check that the files match their recorded hashes: `false`
 * means they didn't, and absent means the caller didn't say, which the verdict then reports.
 */
export type HypothesisPanel = { artifact: ArtifactPointer; bundle: PanelBundle; filesVerified?: boolean }

/** A saved sample result, with the aligned sequence the engine keeps beside it when there is one. */
export type HypothesisResult = { artifact: ArtifactPointer; result: Result; aligned?: string; filesVerified?: boolean }

/** Everything a test may read. Only what's in here: a test never builds or fetches anything to fill a gap. */
export type HypothesisArtifacts = { panels: readonly HypothesisPanel[]; results: readonly HypothesisResult[] }

/** What a verdict rests on: which artifact, its hash, the run that made it, and the finding or row inside it. */
export type HypothesisCitation = {
  artifact: ArtifactPointer
  /** The panel's checksum, or for a result the hash of the result (and aligned sequence) as read. */
  hash: string
  /** The run that produced it, for a result. A panel names what it was built from (`builtBy`) in `rests` instead. */
  run?: Id
  /** Where inside the artifact, such as `findings.2` or `pairs.4`. */
  path?: string
  /** In plain words, what this citation shows. */
  rests: string
}

/** The test, stated before it runs. A plan that isn't testable says why, and running it changes nothing. */
export type StatedTest = {
  claim: HypothesisClaim
  claimText: string
  testable: boolean
  /** Why the claim can't be tested with these artifacts. Only when `testable` is false. */
  reason?: string
  /** The function and rule the test will use. Only when testable. */
  method?: { function: string; rule: string; ruleVersion?: number; calibrated?: false }
  /** What each verdict will mean for this claim, written before the test runs. Only when testable. */
  outcomes?: Partial<Record<HypothesisVerdictName, string>>
  /** The artifacts the test will read, with their hashes now. Running refuses any that changed since. */
  uses: HypothesisCitation[]
  /** The whole stated test in plain words. */
  text: string
}

export type HypothesisVerdict = {
  /** The stated test, exactly as it was before running. */
  plan: StatedTest
  verdict: HypothesisVerdictName
  /** Plain words: what was found and why that gives this verdict. */
  explanation: string
  /** At least one per verdict: the artifacts and findings it rests on. */
  citations: HypothesisCitation[]
  /** Limits the reader needs beside the verdict, such as scope, exploratory status and checks not done here. */
  caveats: string[]
  /** Present, and always false, when the verdict used the uncalibrated distance rule. */
  calibrated?: false
  /** Problems found in the artifacts, when the verdict is `tool or data problem`. */
  diagnostics?: Diagnostic[]
}

const hashOf = (value: unknown) => `sha256:${sha256Hex(canonicalJson(value))}`
const resultHash = (r: HypothesisResult) => hashOf({ result: r.result, aligned: r.aligned ?? null })
const panelHash = (p: HypothesisPanel) => p.bundle.panel.checksum ?? hashOf(p.bundle.panel)
const sameVersion = (a: PanelVersion, b: PanelVersion) => a.id === b.id && a.version === b.version
const versionText = (v: PanelVersion) => `panel ${v.id} version ${v.version}`

const panelUse = (p: HypothesisPanel, rests: string): HypothesisCitation => ({ artifact: p.artifact, hash: panelHash(p), rests: `${rests} (built from ${p.bundle.panel.builtBy})` })
const resultUse = (r: HypothesisResult, rests: string): HypothesisCitation => ({ artifact: r.artifact, hash: resultHash(r), run: r.result.run, rests })

/** The claim in plain words, as the person would say it. */
export function claimText(claim: HypothesisClaim): string {
  const on = (p?: PanelVersion) => (p ? ` (${versionText(p)})` : '')
  switch (claim.kind) {
    case 'sample-in-group': return `Sample ${claim.sample} belongs to group ${claim.group}${on(claim.panel)}`
    case 'groups-distinct': return `Group ${claim.a} is distinct from group ${claim.b} in window ${claim.window}${on(claim.panel)}`
    case 'panel-changed-call': return `${versionText(claim.to)} changed the call for ${claim.sample} from ${versionText(claim.from)}${claim.group ? `, for group ${claim.group}` : ''}`
    case 'possibly-novel': return `Sample ${claim.sample} is possibly novel${on(claim.panel)}`
  }
}

const untestable = (claim: HypothesisClaim, reason: string, uses: HypothesisCitation[] = []): StatedTest => ({
  claim, claimText: claimText(claim), testable: false, reason, uses, text: `This can't be tested with the artifacts given: ${reason}.`,
})

type Pick1<T> = { found: T } | { reason: string }

function findPanel(artifacts: HypothesisArtifacts, version: PanelVersion): Pick1<HypothesisPanel> {
  const hits = artifacts.panels.filter((p) => sameVersion(p.bundle.panel, version))
  if (!hits.length) return { reason: `${versionText(version)} isn't among the loaded panels` }
  if (hits.length > 1) return { reason: `${hits.length} loaded artifacts claim to be ${versionText(version)} (${hits.map((p) => p.artifact.key).join(', ')}), so which one to read isn't clear` }
  return { found: hits[0]! }
}

/** The one panel a claim means: the one it names, or the only one loaded. Never a guess between several. */
function choosePanel(artifacts: HypothesisArtifacts, version?: PanelVersion): Pick1<HypothesisPanel> {
  if (version) return findPanel(artifacts, version)
  if (!artifacts.panels.length) return { reason: 'no panel is loaded' }
  if (artifacts.panels.length > 1) return { reason: `${artifacts.panels.length} panels are loaded and the claim names none of them` }
  return { found: artifacts.panels[0]! }
}

/** The one result for a sample: against the named panel version, or against the only version it has results for. */
function chooseResult(artifacts: HypothesisArtifacts, sample: Id, version?: PanelVersion): Pick1<HypothesisResult> {
  const mine = artifacts.results.filter((r) => r.result.query === sample)
  if (!mine.length) return { reason: `there is no saved result for ${sample}` }
  const hits = version ? mine.filter((r) => sameVersion(r.result.panel, version)) : mine
  if (!hits.length) return { reason: `there is no saved result for ${sample} against ${versionText(version!)}` }
  const versions = new Set(hits.map((r) => `${r.result.panel.id}@${r.result.panel.version}`))
  if (versions.size > 1) return { reason: `${sample} has results against ${versions.size} panel versions and the claim names none of them` }
  if (hits.length > 1) return { reason: `${sample} has ${hits.length} saved results against ${versionText(hits[0]!.result.panel)} (${hits.map((r) => r.artifact.key).join(', ')}), so which one to read isn't clear` }
  return { found: hits[0]! }
}

/** Result and the panel it was made with, both required, so the result can be checked against that panel's seal. */
function resultAndPanel(artifacts: HypothesisArtifacts, sample: Id, version?: PanelVersion): Pick1<{ result: HypothesisResult; panel: HypothesisPanel }> {
  const r = chooseResult(artifacts, sample, version)
  if ('reason' in r) return r
  const p = findPanel(artifacts, r.found.result.panel)
  if ('reason' in p) return { reason: `the result for ${sample} was made with ${versionText(r.found.result.panel)}, and ${p.reason}` }
  return { found: { result: r.found, panel: p.found } }
}

const SEAL_RULE = 'Before reading anything, the panel is checked against its seal (verifyBundle) and the result against that panel (validateResult); any failure is a tool or data problem'

/**
 * States the test for a claim before anything runs: which function, which artifacts and which rule, and what each verdict
 * will mean. It reads only what's needed to name the artifacts, never an outcome. If an artifact, group or window the test
 * needs is missing, the plan is `untestable with this data` and says why.
 */
export function planTest(claim: HypothesisClaim, artifacts: HypothesisArtifacts): StatedTest {
  const said = claimText(claim)
  switch (claim.kind) {
    case 'sample-in-group': {
      const rp = resultAndPanel(artifacts, claim.sample, claim.panel)
      if ('reason' in rp) return untestable(claim, rp.reason)
      const { result, panel } = rp.found
      const uses = [resultUse(result, `The saved result for ${claim.sample}`), panelUse(panel, `The panel it was made with, ${versionText(panel.bundle.panel)}`)]
      if (!panel.bundle.panel.groups.some((g) => g.id === claim.group)) return untestable(claim, `group ${claim.group} isn't in ${versionText(panel.bundle.panel)}`, uses)
      const rule = `Read the finding for group ${claim.group} in the result (evaluateQuery, evaluator version 2). ${SEAL_RULE}`
      const outcomes = {
        refuted: `the finding is excluded_within_panel: a resolved pair of groups rules ${claim.group} out`,
        'not refuted': `the finding is consistent, or inconclusive (compared, but the rules can't rule ${claim.group} out)`,
        'untestable with this data': `the finding is not_evaluable, or the result has no finding for ${claim.group}`,
        'tool or data problem': 'a seal or result check fails, or an artifact changed after this test was stated',
      }
      return stated(claim, said, { function: 'evaluateQuery finding', rule }, outcomes, uses)
    }
    case 'groups-distinct': {
      const p = choosePanel(artifacts, claim.panel)
      if ('reason' in p) return untestable(claim, p.reason)
      const panel = p.found
      const uses = [panelUse(panel, `The pair table of ${versionText(panel.bundle.panel)}`)]
      const missing = [claim.a, claim.b].filter((g) => !panel.bundle.panel.groups.some((x) => x.id === g))
      if (missing.length) return untestable(claim, `${missing.map((g) => `group ${g}`).join(' and ')} ${missing.length > 1 ? "aren't" : "isn't"} in ${versionText(panel.bundle.panel)}`, uses)
      if (claim.a === claim.b) return untestable(claim, 'the claim names the same group twice', uses)
      if (!panel.bundle.panel.windows.some((w) => w.id === claim.window)) return untestable(claim, `window ${claim.window} isn't in ${versionText(panel.bundle.panel)} (it has ${panel.bundle.panel.windows.map((w) => w.id).join(', ')})`, uses)
      const rule = `Read the panel's pair of ${claim.a} and ${claim.b} in window ${claim.window} (deriveEvaluation, as sealed in the panel). "Distinct" means at least one column, with enough records in both groups, where they share no possible base. ${SEAL_RULE.replace(' and the result against that panel (validateResult)', '')}`
      const outcomes = {
        refuted: 'the pair is no_fixed_sites: both groups have enough columns at depth, and no column separates them',
        'not refuted': 'the pair is resolvable: at least one fixed site separates them in these records. Records not sampled could still share a state',
        'untestable with this data': 'the pair is not_evaluable: one group or both lack enough columns at depth in this window',
        'tool or data problem': 'the panel fails its seal or its pair table doesn\'t follow from its sequences, or it changed after this test was stated',
      }
      return stated(claim, said, { function: 'deriveEvaluation pair', rule }, outcomes, uses)
    }
    case 'panel-changed-call': {
      if (sameVersion(claim.from, claim.to)) return untestable(claim, 'both sides name the same panel version')
      const a = resultAndPanel(artifacts, claim.sample, claim.from)
      if ('reason' in a) return untestable(claim, a.reason)
      const b = resultAndPanel(artifacts, claim.sample, claim.to)
      if ('reason' in b) return untestable(claim, b.reason)
      const uses = [
        resultUse(a.found.result, `The result for ${claim.sample} against ${versionText(claim.from)}`), panelUse(a.found.panel, `${versionText(claim.from)}`),
        resultUse(b.found.result, `The result for ${claim.sample} against ${versionText(claim.to)}`), panelUse(b.found.panel, `${versionText(claim.to)}`),
      ]
      const [ha, hb] = [a.found.result.result.querySha256, b.found.result.result.querySha256]
      if (!ha || !hb) return untestable(claim, `the result against ${versionText(!ha ? claim.from : claim.to)} doesn't record a hash of the sequence it tested, so nothing shows both tested the same sequence`, uses)
      if (ha !== hb) return untestable(claim, `the two results tested different sequences (${ha} and ${hb}), so they don't show what the panel version changed`, uses)
      if (claim.group && ![a.found, b.found].some((x) => x.panel.bundle.panel.groups.some((g) => g.id === claim.group))) return untestable(claim, `group ${claim.group} isn't in either panel version`, uses)
      const which = claim.group ? `group ${claim.group}` : 'every group in either version'
      const rule = `Compare the finding status of ${which} in the two results (evaluateQuery). The call is the status per group; reasons and counts that change without a status changing don't count. A group in only one version counts as a change. ${SEAL_RULE}, for both versions`
      const outcomes = {
        refuted: `every compared group has the same status in both results`,
        'not refuted': `at least one compared group's status differs, or a group is in only one version`,
        'tool or data problem': 'a seal or result check fails on either side, or an artifact changed after this test was stated',
      }
      return stated(claim, said, { function: 'evaluateQuery finding status, compared', rule }, outcomes, uses)
    }
    case 'possibly-novel': {
      const rp = resultAndPanel(artifacts, claim.sample, claim.panel)
      if ('reason' in rp) return untestable(claim, rp.reason)
      const { result, panel } = rp.found
      const uses = [resultUse(result, `The saved result and aligned sequence for ${claim.sample}`), panelUse(panel, `The panel it was made with, ${versionText(panel.bundle.panel)}, and its sequences`)]
      if (!result.aligned) return untestable(claim, `the saved result for ${claim.sample} has no aligned sequence, which the distance rule needs`, uses)
      const rule = `Run noveltyByDistance on the saved aligned sequence and the panel's records: per window, possibly novel when the nearest panel record is farther than the 95th percentile of the panel's own leave-one-site-out within-group distances (at least ${DISTANCE_NOVELTY_RULE.minReferenceDistances}). ${UNCALIBRATED_NOTE}. ${SEAL_RULE}`
      const outcomes = {
        refuted: 'the overall status is within-range: every evaluable window is within the panel\'s own spread',
        'not refuted': 'the overall status is possibly-novel: every evaluable window is beyond it',
        'untestable with this data': 'the overall status is not-evaluable, or windows-disagree, which the stated rule leaves unsettled',
        'tool or data problem': 'a seal or result check fails, the aligned sequence doesn\'t fit the panel\'s reference, or an artifact changed after this test was stated',
      }
      return stated(claim, said, { function: 'noveltyByDistance', rule, ruleVersion: DISTANCE_NOVELTY_RULE.version, calibrated: false }, outcomes, uses)
    }
  }
}

function stated(claim: HypothesisClaim, said: string, method: NonNullable<StatedTest['method']>, outcomes: NonNullable<StatedTest['outcomes']>, uses: HypothesisCitation[]): StatedTest {
  const reads = uses.map((u) => `${u.artifact.type} ${u.artifact.key} (${u.hash}${u.run ? `, run ${u.run}` : ''})`).join('; ')
  const each = (Object.entries(outcomes) as [HypothesisVerdictName, string][]).map(([v, when]) => `${v} if ${when}`).join('; ')
  const text = `To test "${said}", I will read ${reads}. ${method.rule}. Verdicts: ${each}. Not refuted never means confirmed.`
  return { claim, claimText: said, testable: true, method, outcomes, uses, text }
}

/** Limits every verdict on a result carries. */
function resultCaveats(r: Result): string[] {
  return [
    'Every result so far is exploratory (analysis protocol section 1): this verdict is a check on saved findings, not a confirmatory test',
    ...r.outOfValidatedScope.map((s) => `Outside the panel's validated scope: ${s}`),
  ]
}

function filesCaveat(items: { artifact: ArtifactPointer; filesVerified?: boolean }[]): string[] {
  const unknown = items.filter((x) => x.filesVerified === undefined)
  return unknown.length ? [`The store's file hashes weren't checked by the caller for ${unknown.map((x) => `${x.artifact.type} ${x.artifact.key}`).join(', ')}; only the panel seal and result checks ran here`] : []
}

type Resolved = { panels: HypothesisPanel[]; results: HypothesisResult[] }

/** Finds each artifact the plan named, by key, and refuses any that changed or went missing since the plan was stated. */
function resolveUses(plan: StatedTest, artifacts: HypothesisArtifacts): Resolved | { problem: string; diagnostics: Diagnostic[] } {
  const out: Resolved = { panels: [], results: [] }
  const diagnostics: Diagnostic[] = []
  for (const use of plan.uses) {
    const panel = artifacts.panels.find((p) => p.artifact.type === use.artifact.type && p.artifact.key === use.artifact.key)
    const result = artifacts.results.find((r) => r.artifact.type === use.artifact.type && r.artifact.key === use.artifact.key)
    const now = panel ? panelHash(panel) : result ? resultHash(result) : undefined
    const name = `${use.artifact.type} ${use.artifact.key}`
    if (now === undefined) diagnostics.push({ severity: 'error', code: 'artifact-missing', message: `${name}, named in the stated test, isn't among the artifacts given` })
    else if (now !== use.hash) diagnostics.push({ severity: 'error', code: 'artifact-changed', message: `${name} changed after the test was stated (${use.hash}, now ${now})` })
    else if ((panel ?? result)!.filesVerified === false) diagnostics.push({ severity: 'error', code: 'files-changed', message: `The store reports that the files of ${name} don't match their recorded hashes` })
    if (panel) out.panels.push(panel)
    if (result) out.results.push(result)
  }
  if (diagnostics.length) return { problem: diagnostics.map((d) => d.message).join('; '), diagnostics }
  // Seal checks: a panel against its own seal, and each result against the panel it names.
  for (const p of out.panels) for (const d of verifyBundle(p.bundle)) diagnostics.push({ ...d, message: `${versionText(p.bundle.panel)}: ${d.message}` })
  for (const r of out.results) {
    const p = out.panels.find((x) => sameVersion(x.bundle.panel, r.result.panel))
    for (const d of validateResult(r.result, p?.bundle.panel)) if (d.severity === 'error') diagnostics.push({ ...d, message: `Result ${r.artifact.key}: ${d.message}` })
  }
  if (diagnostics.length) return { problem: diagnostics.map((d) => d.message).join('; '), diagnostics }
  return out
}

const findingCitation = (r: HypothesisResult, f: Finding, i: number): HypothesisCitation =>
  ({ ...resultUse(r, `Group ${f.group}: ${f.status} (${f.reasonCode}). ${f.reason}`), path: `findings.${i}` })

/**
 * Runs a stated test on the same artifacts, read only, and returns one verdict from the closed list with what it rests
 * on. A plan that wasn't testable comes back `untestable with this data` with its reason, without running anything.
 * The plan is returned as it was given: nothing here changes it, the artifacts or anything else.
 */
export function runTest(plan: StatedTest, artifacts: HypothesisArtifacts): HypothesisVerdict {
  const base = { plan }
  if (!plan.testable) {
    return { ...base, verdict: 'untestable with this data', explanation: `Not tested: ${plan.reason ?? 'the stated test found it untestable'}.`, citations: plan.uses, caveats: [] }
  }
  const resolved = resolveUses(plan, artifacts)
  if ('problem' in resolved) {
    return { ...base, verdict: 'tool or data problem', explanation: `The test didn't run, because the artifacts it needs failed their checks: ${resolved.problem}.`, citations: plan.uses, caveats: [], diagnostics: resolved.diagnostics }
  }
  const claim = plan.claim
  const files = filesCaveat([...resolved.panels, ...resolved.results])
  switch (claim.kind) {
    case 'sample-in-group': return sampleInGroup(plan, claim, resolved, files)
    case 'groups-distinct': return groupsDistinct(plan, claim, resolved, files)
    case 'panel-changed-call': return changedCall(plan, claim, resolved, files)
    case 'possibly-novel': return possiblyNovel(plan, claim, resolved, files)
  }
}

function sampleInGroup(plan: StatedTest, claim: Extract<HypothesisClaim, { kind: 'sample-in-group' }>, { results, panels }: Resolved, files: string[]): HypothesisVerdict {
  const r = results[0]!
  const caveats = [...resultCaveats(r.result), ...files]
  const i = r.result.findings.findIndex((f) => f.group === claim.group)
  if (i < 0) return { plan, verdict: 'untestable with this data', explanation: `The result has no finding for group ${claim.group}.`, citations: [resultUse(r, `The saved result for ${claim.sample}, which has no finding for ${claim.group}`)], caveats }
  const f = r.result.findings[i]!
  const cite = [findingCitation(r, f, i)]
  if (f.status === 'excluded_within_panel') {
    // validateResult has already checked that a resolved pair rules it out; cite those pairs too.
    r.result.pairs.forEach((p, j) => {
      if (p.state === 'resolved' && p.favors !== f.group && (p.a === f.group || p.b === f.group))
        cite.push({ ...resultUse(r, `${p.a} vs ${p.b}: resolved, favoring ${p.favors} (${p.forA} sites for ${p.a}, ${p.forB} for ${p.b})`), path: `pairs.${j}` })
    })
    return { plan, verdict: 'refuted', explanation: `Group ${claim.group} is excluded within ${versionText(r.result.panel)} for ${claim.sample}: ${f.reason}.`, citations: cite, caveats: [...caveats, 'Excluded within this panel only: a group the panel lacks could still be the answer'] }
  }
  if (f.status === 'not_evaluable') return { plan, verdict: 'untestable with this data', explanation: `Group ${claim.group} couldn't be compared with ${claim.sample} in ${versionText(r.result.panel)}: ${f.reason}.`, citations: cite, caveats }
  const what = f.status === 'consistent' ? 'consistent with it' : "inconclusive: compared, but the panel's rules can't rule it out"
  return {
    plan, verdict: 'not refuted', explanation: `${claim.sample} is ${what} (${f.reason}). Not refuted isn't confirmed.`, citations: cite,
    caveats: [...caveats, ...(f.status === 'inconclusive' ? [`The finding is inconclusive, not consistent: the sequence doesn't simply fit ${claim.group}`] : []), ...(panels[0]?.bundle.panel.notCovered.length ? [`The panel doesn't cover: ${panels[0].bundle.panel.notCovered.join(', ')}`] : [])],
  }
}

function groupsDistinct(plan: StatedTest, claim: Extract<HypothesisClaim, { kind: 'groups-distinct' }>, { panels }: Resolved, files: string[]): HypothesisVerdict {
  const p = panels[0]!
  const panel = p.bundle.panel
  const i = panel.pairs.findIndex((x) => x.window === claim.window && ((x.a === claim.a && x.b === claim.b) || (x.a === claim.b && x.b === claim.a)))
  const caveats = ['Every result so far is exploratory (analysis protocol section 1): this verdict is a check on saved findings, not a confirmatory test', ...files]
  if (i < 0) return { plan, verdict: 'untestable with this data', explanation: `The panel has no pair entry for ${claim.a} and ${claim.b} in ${claim.window}.`, citations: [panelUse(p, 'The pair table, which has no such entry')], caveats }
  const pair: PanelPair = panel.pairs[i]!
  const cite = (rests: string): HypothesisCitation[] => [{ ...panelUse(p, rests), path: `pairs.${i}` }]
  const counts = `${pair.records.a} and ${pair.records.b} records, ${pair.blocks.a} and ${pair.blocks.b} sites`
  if (pair.state === 'not_evaluable') return { plan, verdict: 'untestable with this data', explanation: `${claim.a} and ${claim.b} can't be compared in ${claim.window}: ${pair.reason ?? 'not evaluable'}.`, citations: cite(`${pair.a} vs ${pair.b} in ${pair.window}: not_evaluable (${counts}). ${pair.reason ?? ''}`.trim()), caveats }
  if (pair.state === 'no_fixed_sites') return { plan, verdict: 'refuted', explanation: `No column in ${claim.window} separates ${claim.a} from ${claim.b} in this panel's records (${counts}).`, citations: cite(`${pair.a} vs ${pair.b} in ${pair.window}: no_fixed_sites (${counts})`), caveats: [...caveats, 'Refuted for fixed sites in this window only: the groups may still differ in how common each state is, or in other windows'] }
  const validated = panel.claims.find((c) => c.window === claim.window && ((c.a === claim.a && c.b === claim.b) || (c.a === claim.b && c.b === claim.a)))
  return {
    plan, verdict: 'not refuted', explanation: `${pair.sites.length} fixed site${pair.sites.length === 1 ? '' : 's'} separate ${claim.a} from ${claim.b} in ${claim.window} (${counts}). Not refuted isn't confirmed.`,
    citations: cite(`${pair.a} vs ${pair.b} in ${pair.window}: resolvable, ${pair.sites.length} fixed sites at ${pair.sites.slice(0, 10).map((s) => s.position).join(', ')}${pair.sites.length > 10 ? ', ...' : ''}`),
    caveats: [...caveats, 'Fixed in the records sampled: each site lists a 95% upper bound on the share of a group carrying a state not seen yet, and records not sampled could share one',
      validated ? `This pair is a validated claim of the panel (${validated.basis}, ${validated.minColumns}+ columns)` : 'This pair is not among the panel\'s validated claims'],
  }
}

function changedCall(plan: StatedTest, claim: Extract<HypothesisClaim, { kind: 'panel-changed-call' }>, { results }: Resolved, files: string[]): HypothesisVerdict {
  const a = results.find((r) => sameVersion(r.result.panel, claim.from))!
  const b = results.find((r) => sameVersion(r.result.panel, claim.to))!
  const groups = claim.group ? [claim.group] : [...new Set([...a.result.findings, ...b.result.findings].map((f) => f.group))].sort()
  const changed: HypothesisCitation[] = []
  const same: string[] = []
  for (const g of groups) {
    const [i, j] = [a.result.findings.findIndex((f) => f.group === g), b.result.findings.findIndex((f) => f.group === g)]
    const [fa, fb] = [a.result.findings[i], b.result.findings[j]]
    if (fa && fb && fa.status === fb.status) { same.push(`${g} ${fa.status}`); continue }
    if (fa) changed.push(findingCitation(a, fa, i))
    else changed.push(resultUse(a, `Group ${g} has no finding in ${versionText(claim.from)}`))
    if (fb) changed.push(findingCitation(b, fb, j))
    else changed.push(resultUse(b, `Group ${g} has no finding in ${versionText(claim.to)}`))
  }
  const caveats = [...resultCaveats(a.result), ...resultCaveats(b.result).slice(1), ...files]
  if (changed.length) {
    return { plan, verdict: 'not refuted', explanation: `The call changed between ${versionText(claim.from)} and ${versionText(claim.to)} for ${claim.sample}, for ${changed.length / 2} group${changed.length === 2 ? '' : 's'}. This says the status changed, not which version is right.`, citations: changed, caveats }
  }
  return {
    plan, verdict: 'refuted', explanation: `Every compared group has the same status against both versions: ${same.join(', ')}.`,
    citations: [resultUse(a, `Statuses against ${versionText(claim.from)}: ${same.join(', ')}`), resultUse(b, `Statuses against ${versionText(claim.to)}: the same`)],
    caveats: [...caveats, 'The same status can rest on different counts or reasons; only the status was compared'],
  }
}

function possiblyNovel(plan: StatedTest, claim: Extract<HypothesisClaim, { kind: 'possibly-novel' }>, { results, panels }: Resolved, files: string[]): HypothesisVerdict {
  const r = results[0]!
  const p = panels[0]!
  const base = { plan, calibrated: false as const }
  const caveats = [UNCALIBRATED_NOTE, ...resultCaveats(r.result), ...files]
  if (r.aligned!.length !== p.bundle.panel.reference.length) {
    const diagnostics: Diagnostic[] = [{ severity: 'error', code: 'aligned-length', message: `The saved aligned sequence has ${r.aligned!.length} columns, but the panel's reference has ${p.bundle.panel.reference.length}` }]
    return { ...base, verdict: 'tool or data problem', explanation: `${diagnostics[0]!.message}, so it can't have been aligned to this panel.`, citations: plan.uses, caveats, diagnostics }
  }
  const novelty = noveltyByDistance(p.bundle, r.aligned!)
  const windowCite = (w: DistanceNoveltyWindow, k: number): HypothesisCitation => ({ ...resultUse(r, `Window ${w.window}: ${w.status}. ${w.reason}`), path: `distance-novelty.windows.${k}` })
  const citations = [...novelty.windows.map(windowCite), panelUse(p, `The panel's own within-group distances, per window (rule version ${novelty.ruleVersion})`)]
  const prefix = `Uncalibrated distance rule (version ${novelty.ruleVersion}): `
  if (novelty.status === 'possibly-novel') return { ...base, verdict: 'not refuted', explanation: `${prefix}${claim.sample} is farther from every panel record than the panel's own groups are, in every evaluable window. Not refuted isn't confirmed, and the rule's error rates are unknown.`, citations, caveats }
  if (novelty.status === 'within-range') return { ...base, verdict: 'refuted', explanation: `${prefix}${claim.sample} is within the distance the panel's own groups show, in every evaluable window. The rule's error rates are unknown, so this is weak evidence.`, citations, caveats }
  if (novelty.status === 'windows-disagree') return { ...base, verdict: 'untestable with this data', explanation: `${prefix}windows disagree (${novelty.windows.filter((w) => w.status !== 'not-evaluable').map((w) => `${w.window} ${w.status}`).join(', ')}), and the stated rule doesn't settle that either way.`, citations, caveats }
  return { ...base, verdict: 'untestable with this data', explanation: `${prefix}no window could be tested: ${novelty.windows.map((w) => `${w.window}: ${w.reason}`).join('; ')}.`, citations, caveats }
}
