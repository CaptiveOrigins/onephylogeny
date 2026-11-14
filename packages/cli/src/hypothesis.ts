import { HYPOTHESIS_VERDICTS, type HypothesisCitation, type HypothesisClaim, type HypothesisClaimKind, type HypothesisVerdictName, type StatedTest } from '@extantape/onephylogeny-core'
import type { HypothesisOutcome, HypothesisPlan } from '@extantape/onephylogeny-engine'

export const CLAIM_KINDS: readonly HypothesisClaimKind[] = ['sample-in-group', 'groups-distinct', 'panel-changed-call', 'possibly-novel']

/** A mistake in how the command was called. The only kind of `hypothesis` failure that exits non-zero. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

const need = (value: string | undefined, name: string, kind: string): string => {
  if (!value || value.startsWith('--')) throw new UsageError(`--claim ${kind} needs --${name}`)
  return value
}

/**
 * Turns the command's flags into one structured claim (ADR 0013). `panelId` is the profile's panel, which `--version`,
 * `--a` and `--b` name versions of; a lone panel folder (`--dir`) is the only panel, so it needs no version.
 */
export function claimFromFlags(flag: (name: string) => string | undefined, panelId: string | undefined): HypothesisClaim {
  const kind = flag('claim')
  if (!kind || kind.startsWith('--')) throw new UsageError(`--claim is required: one of ${CLAIM_KINDS.join(', ')}`)
  if (!CLAIM_KINDS.includes(kind as HypothesisClaimKind)) throw new UsageError(`Unknown claim ${kind}. The claims are: ${CLAIM_KINDS.join(', ')}`)
  const version = flag('version')
  const versionOf = (v: string) => {
    if (!panelId) throw new UsageError('Naming a panel version needs a profile with panel settings')
    return { id: panelId, version: v }
  }
  const panel = version ? { panel: versionOf(need(version, 'version', kind)) } : {}
  switch (kind as HypothesisClaimKind) {
    case 'sample-in-group':
      return { kind: 'sample-in-group', sample: need(flag('sample'), 'sample', kind), group: need(flag('group'), 'group', kind), ...panel }
    case 'groups-distinct': {
      const groups = need(flag('groups'), 'groups', kind).split(',').map((g) => g.trim()).filter(Boolean)
      if (groups.length !== 2) throw new UsageError('--groups takes two groups, separated by a comma: --groups a,b')
      return { kind: 'groups-distinct', a: groups[0]!, b: groups[1]!, window: need(flag('window'), 'window', kind), ...panel }
    }
    case 'panel-changed-call': {
      const sample = flag('record') ?? flag('sample')
      const group = flag('group')
      return { kind: 'panel-changed-call', sample: need(sample, 'record', kind), from: versionOf(need(flag('a'), 'a', kind)), to: versionOf(need(flag('b'), 'b', kind)), ...(group ? { group } : {}) }
    }
    case 'possibly-novel':
      return { kind: 'possibly-novel', sample: need(flag('sample'), 'sample', kind), ...panel }
  }
}

const short = (hash: string) => hash.replace(/^(sha256:)?([0-9a-f]{12})[0-9a-f]{52}$/, (_, p = '', h) => `${p}${h}…`)
const where = (c: HypothesisCitation) => [`${c.artifact.type} ${short(c.artifact.key)}`, ...(c.path ? [c.path] : []), ...(c.run ? [`run ${c.run}`] : [])].join(', ')
const bullet = (lines: string[]) => lines.map((l) => `  - ${l}`)
const ORDER: HypothesisVerdictName[] = [...HYPOTHESIS_VERDICTS]

/** The stated test in plain words: what the claim is, what will be read, by which rule, and what each verdict will mean. */
export function planText(plan: HypothesisPlan): string {
  const s: StatedTest = plan.stated
  const lines = [`Claim: ${s.claimText}.`, '']
  if (!s.testable) {
    lines.push(`Stated test: none. This can't be tested with the saved data: ${s.reason}.`)
    if (s.uses.length) lines.push('', 'It looked at:', ...bullet(s.uses.map((u) => `${u.rests} (${where(u)})`)))
  } else {
    lines.push('Stated test, before it runs:', `  Method: ${s.method!.function}${s.method!.calibrated === false ? ' (uncalibrated)' : ''}.`, `  Rule: ${s.method!.rule}.`, '  Reads:', ...s.uses.map((u) => `    - ${u.rests} (${where(u)})`), '  What each verdict will mean:')
    for (const v of ORDER) if (s.outcomes?.[v]) lines.push(`    - ${v}: ${s.outcomes[v]}.`)
    lines.push('  Not refuted never means confirmed.')
  }
  if (plan.notes.length) lines.push('', 'Notes from loading:', ...bullet(plan.notes))
  return `${lines.join('\n')}\n`
}

/** The verdict in plain words, with what it rests on and its limits. */
export function verdictText(outcome: HypothesisOutcome): string {
  const lines = [`Verdict: ${outcome.verdict}.`, `  ${outcome.explanation}`]
  if (outcome.calibrated === false) lines.push('  The rule behind this verdict is uncalibrated.')
  if (outcome.citations.length) lines.push('', 'It rests on:', ...bullet(outcome.citations.map((c) => `${c.rests} (${where(c)})`)))
  if (outcome.diagnostics?.length) lines.push('', 'Problems found:', ...bullet(outcome.diagnostics.map((d) => d.message)))
  if (outcome.caveats.length) lines.push('', 'Caveats:', ...bullet(outcome.caveats))
  if (outcome.notes.length) lines.push('', 'Notes from loading:', ...bullet(outcome.notes))
  return `${lines.join('\n')}\n`
}
