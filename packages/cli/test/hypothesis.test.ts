import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HypothesisOutcome, HypothesisPlan } from '@captiveorigins/onephylogeny-engine'
import { claimFromFlags, planText, UsageError, verdictText } from '../src/hypothesis'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const cli = `${repo}packages/cli/dist/index.js`
const offline = `${repo}fixtures/tutorial/offline-ncbi.mjs`
const flags = (given: Record<string, string>) => (name: string) => given[name]

describe('hypothesis: claims from flags', () => {
  it('builds each claim kind, naming versions of the profile panel', () => {
    expect(claimFromFlags(flags({ claim: 'sample-in-group', sample: 's1', group: 'a' }), 'p')).toEqual({ kind: 'sample-in-group', sample: 's1', group: 'a' })
    expect(claimFromFlags(flags({ claim: 'groups-distinct', groups: 'a, b', window: 'whole', version: '2' }), 'p')).toEqual({ kind: 'groups-distinct', a: 'a', b: 'b', window: 'whole', panel: { id: 'p', version: '2' } })
    expect(claimFromFlags(flags({ claim: 'panel-changed-call', record: 'r', a: '1', b: '2' }), 'p')).toEqual({ kind: 'panel-changed-call', sample: 'r', from: { id: 'p', version: '1' }, to: { id: 'p', version: '2' } })
    expect(claimFromFlags(flags({ claim: 'possibly-novel', sample: 's1' }), 'p')).toEqual({ kind: 'possibly-novel', sample: 's1' })
  })

  it('refuses usage mistakes in plain words', () => {
    expect(() => claimFromFlags(flags({}), 'p')).toThrow(UsageError)
    expect(() => claimFromFlags(flags({ claim: 'confirmed' }), 'p')).toThrow(/Unknown claim confirmed/)
    expect(() => claimFromFlags(flags({ claim: 'sample-in-group', sample: 's1' }), 'p')).toThrow('--claim sample-in-group needs --group')
    expect(() => claimFromFlags(flags({ claim: 'groups-distinct', groups: 'a', window: 'w' }), 'p')).toThrow(/two groups/)
    expect(() => claimFromFlags(flags({ claim: 'panel-changed-call', record: 'r', a: '1', b: '2' }), undefined)).toThrow(/needs a profile with panel settings/)
  })
})

const stated = {
  claim: { kind: 'sample-in-group' as const, sample: 's1', group: 'b' }, claimText: 'Sample s1 belongs to group b', testable: true,
  method: { function: 'evaluateQuery finding', rule: 'Read the finding for group b' },
  outcomes: { refuted: 'the finding is excluded_within_panel', 'not refuted': 'the finding is consistent' },
  uses: [{ artifact: { type: 'sample-result', key: `sha256:${'a'.repeat(64)}` }, hash: 'h', run: 'run-1', rests: 'The saved result for s1' }],
  text: '',
}

describe('hypothesis: printing', () => {
  it('states the test before anything else, with what it reads and what each verdict will mean', () => {
    const text = planText({ stated, sources: [], notes: ['A note'] } satisfies HypothesisPlan)
    expect(text.startsWith('Claim: Sample s1 belongs to group b.\n\nStated test, before it runs:\n')).toBe(true)
    expect(text).toContain(`    - The saved result for s1 (sample-result sha256:aaaaaaaaaaaa…, run run-1)`)
    expect(text).toContain('    - refuted: the finding is excluded_within_panel.')
    expect(text).toContain('  Not refuted never means confirmed.')
    expect(text).toContain('Notes from loading:\n  - A note')
  })

  it('says why an untestable claim has no test', () => {
    const text = planText({ stated: { ...stated, testable: false, reason: 'there is no saved result for s1', uses: [] }, sources: [], notes: [] })
    expect(text).toBe("Claim: Sample s1 belongs to group b.\n\nStated test: none. This can't be tested with the saved data: there is no saved result for s1.\n")
  })

  it('prints the verdict, what it rests on, problems and caveats', () => {
    const outcome: HypothesisOutcome = {
      plan: stated, verdict: 'tool or data problem', explanation: "The test didn't run.", citations: [{ ...stated.uses[0]!, path: 'findings.1' }], caveats: ['Exploratory'],
      diagnostics: [{ severity: 'error', code: 'files-changed', message: 'Files changed' }], notes: [], calibrated: false,
    }
    expect(verdictText(outcome)).toBe([
      'Verdict: tool or data problem.', "  The test didn't run.", '  The rule behind this verdict is uncalibrated.', '',
      'It rests on:', '  - The saved result for s1 (sample-result sha256:aaaaaaaaaaaa…, findings.1, run run-1)', '',
      'Problems found:', '  - Files changed', '', 'Caveats:', '  - Exploratory', '',
    ].join('\n'))
  })
})

describe('hypothesis: the command', () => {
  let ws: string
  const run = (...args: string[]) => spawnSync('node', [cli, 'hypothesis', '--workspace', ws, '--profile', 'tutorial', ...args], { encoding: 'utf8' })
  beforeAll(() => {
    expect(existsSync(cli), 'build the CLI first: pnpm build').toBe(true)
    ws = mkdtempSync(join(tmpdir(), 'onephylogeny-hypothesis-'))
    mkdirSync(join(ws, 'profiles/tutorial'), { recursive: true })
    for (const f of ['profile.json', 'curation.json']) cpSync(`${repo}fixtures/tutorial/${f}`, join(ws, 'profiles/tutorial', f))
    // The tutorial's own panel and samples, made offline.
    for (const step of [['fetch'], ['panel'], ['test', '--fasta', `${repo}fixtures/tutorial/samples.fasta`]]) {
      const r = spawnSync('node', [cli, ...step, '--workspace', ws, '--profile', 'tutorial'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import ${offline}` }, maxBuffer: 1 << 26 })
      expect(r.status, `${step[0]}: ${r.stderr}`).toBe(0)
    }
  }, 60_000)
  afterAll(() => rmSync(ws, { recursive: true, force: true }))

  it('prints the stated test, then a refuted verdict, and exits 0', () => {
    const r = run('--claim', 'sample-in-group', '--sample', 'sample-1', '--group', 'd')
    expect(r.status).toBe(0)
    expect(r.stdout.indexOf('Stated test, before it runs:')).toBeLessThan(r.stdout.indexOf('Verdict: refuted.'))
    expect(r.stdout).toMatch(/^Claim: Sample sample-1 belongs to group d\./)
    expect(r.stdout).toContain('It rests on:')
    expect(r.stdout).toContain('Caveats:')
  })

  it('exits 0 for not refuted and untestable too', () => {
    const fits = run('--claim', 'sample-in-group', '--sample', 'sample-1', '--group', 'a')
    expect([fits.status, fits.stdout.includes('Verdict: not refuted.')]).toEqual([0, true])
    const refused = run('--claim', 'sample-in-group', '--sample', 'sample-3', '--group', 'a')
    expect([refused.status, refused.stdout.includes('Verdict: untestable with this data.')]).toEqual([0, true])
  })

  it('exits 0 for a tool or data problem, which is an answer about the data', () => {
    const file = join(ws, 'profiles/tutorial/results/tutorial-panel-1/sample-2.json')
    appendFileSync(file, '\n')
    const r = run('--claim', 'sample-in-group', '--sample', 'sample-2', '--group', 'a')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Verdict: tool or data problem.')
  })

  it('stops after the stated test with --plan-only, and runs nothing', () => {
    const r = run('--claim', 'groups-distinct', '--groups', 'a,d', '--window', 'whole', '--plan-only')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Stated test, before it runs:')
    expect(r.stdout).not.toContain('Verdict:')
    const json = JSON.parse(run('--claim', 'groups-distinct', '--groups', 'a,d', '--window', 'whole', '--plan-only', '--json').stdout)
    expect(Object.keys(json)).toEqual(['plan'])
    expect(json.plan.stated.testable).toBe(true)
  })

  it('gives the plan and the outcome as JSON', () => {
    const json = JSON.parse(run('--claim', 'groups-distinct', '--groups', 'a,d', '--window', 'whole', '--json').stdout)
    expect(json.outcome.verdict).toBe('not refuted')
    expect(json.outcome.plan).toEqual(json.plan.stated)
  })

  it('reads a lone panel folder with --dir, needing no workspace or profile', () => {
    const r = spawnSync('node', [cli, 'hypothesis', '--dir', join(ws, 'profiles/tutorial/panels/tutorial-panel-1'), '--claim', 'groups-distinct', '--groups', 'a,c', '--window', 'whole'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Verdict: not refuted.')
    expect(r.stdout).not.toContain('Notes from loading')
  })

  it('exits non-zero only for usage mistakes', () => {
    for (const args of [[], ['--claim', 'confirmed'], ['--claim', 'sample-in-group', '--sample', 'sample-1']]) {
      const r = run(...args)
      expect(r.status, args.join(' ')).toBe(1)
      expect(r.stdout).toBe('')
    }
  })
})
