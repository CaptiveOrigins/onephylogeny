import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Runs every command in docs/tutorial.md, in order, and checks that key lines appear both in the real output and on the
// page, so the tutorial can't drift from the code. Needs the CLI built first (`pnpm build`), as CI does.
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const page = readFileSync(`${repo}docs/tutorial.md`, 'utf8')
const offline = `${repo}fixtures/tutorial/offline-ncbi.mjs`

// Each runnable block is a ```sh fence right after a `<!-- step: NAME -->` comment.
const steps = [...page.matchAll(/<!-- step: ([\w-]+) -->\n```sh\n([\s\S]*?)```/g)].map((m) => ({ name: m[1]!, script: m[2]! }))
const NOT_RUN = new Set(['install']) // needs the network: cloning and installing are what CI already does

/** Key lines per step. Each must appear in that step's output and somewhere on the page. */
const expected: Record<string, string[]> = {
  setup: [],
  fetch: ['[gate] 14 records passed, 1 excluded', '[anchor] Reference NC_080265.1: 1144 columns', '"status": "succeeded"', '"records": 15', '"passed": 14'],
  sheet: ['record,group,provenance_class,use,site,study,origin_source,exclude,note,organism,length,title', 'FM165591.1,a,wild-documented,,a-1,'],
  panel: ['"whole: 6 records, 6 sites"', '"a / d in whole: 30 sites"', '"FAIL sites: 6 and 2 sites, and 4 needed for each"', '"passed": false'],
  verify: ['"verified": true', '"examples": 6'],
  tamper: ['"verified": false', 'panel.fasta has changed since the dataset was written', "doesn't match its seal"],
  test: [
    `"reason": "Within this group's spread: 0 of 4 allowed over 900 columns in whole; 40 separating sites covered"`,
    '"result": null',
    'Only 80 columns align to the reference (minimum 100): probably a different gene or a poor fragment',
  ],
  report: [
    'This result falls outside what the panel has been validated for, so no region is named.',
    '| Group A | Consistent | 900 |',
    '| Group D | Ruled out within this panel | 900 |',
    '| Group B vs Group C | Not separated by the columns this sequence covers (sites-disagree) |',
    '- Rules are configured values and these statuses are not probabilities',
  ],
  'report-2': [
    'The sequence fits no single group, so no region can be named.',
    '| Group B | Consistent | 140 |',
    '| Group C | Inconclusive | 140 |',
    '| Group A vs Group B | Not separated by the columns this sequence covers (too-few-decisive-sites) |',
    '- More than one group fits this sequence: Group A, Group B.',
  ],
  'report-3': ['This sample was refused, so there is no result to report: Only 80 columns align to the reference (minimum 100)'],
  sanger: ['Kept bases 15 to 1090 of 1165 by quality.', '10 kept bases below Q20 became N.', '>226032_C-ME-18_pCAGseqF status=usable kept=15-1090', 'TTTNGGCAANANNTGAGCTCTATGGCCACAACCATGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCA'],
  'sanger-failed': ['fixtures/abi/310.ab1: the read failed, so there is no sequence to use'],
  'test-read': ['"code": "no-reference-match"', 'Shares no seed with the reference, in either orientation: probably a different gene'],
  'sanger-pair': ['Reverse (fixtures/abi/310.ab1): No stretch of the read is above the quality cutoff: the read failed.', 'fixtures/abi/310.ab1 failed, so only fixtures/abi/3730.ab1 is used, alone and not joined.', '>226032_C-ME-18_pCAGseqF status=usable kept=15-1090 alone'],
  primers: ['"status": "ok"', '"columns": 1050', '"of": 1144'],
  'primers-refused': ['"status": "refused"', 'The reverse primer matches nowhere in the reference within 3 mismatches.'],
  snps: [
    'VCF: 8 samples, 12 sites used.',
    'Skipped 1 site: filter not PASS (lowQ).',
    'Nearest SNP neighbours all in the same group: 2 of 7. Tied between its own group and another: 1. No neighbour with enough shared sites: 0.',
    'A      3        0 of 3                 1     0.306        0.485',
    'B      4        2 of 4                 0     0.558        0.485',
    'Grouped but not in the VCF: d-1',
    'In the VCF but not grouped: c-1',
    'These are descriptions, not probabilities.',
  ],
  'snps-json': ['"compared": 7', '"nearestSameGroup": 2', '"nearestTied": 1', '"meanWithin": 0.3055555555555555', '"meanBetween": 0.485479797979798'],
  regroup: ['"applied": true', '"record": "FN185748.1"', '[panel] Finished'],
  compare: [
    '# tutorial-panel 1 compared with tutorial-panel 2',
    "It doesn't say which is better",
    '13 records in both, 0 only in A, 0 only in B. 1 of the shared records changed group.',
    '| FN185748.1 | Group A | Group C |',
    'These differ, so changes may not come from the records alone: Groups, Site tables. The aligned sequences are identical.',
    '6 claims, each one pair of groups in one window. 1 of them is the same in both versions.',
    '| Group A vs Group C, Whole marker | Same outcome, different report | Failed at the sites gate. Group A: 6 sites, 6 records. Group C: 3 sites, 3 records. | Failed at the interval gate. Group A: 5 sites, 5 records. Group C: 4 sites, 4 records. |',
    '### Whole marker, holding out each site',
    '| Group A | 1 | 6 | 0 | 6 | 6 of 6 (54% to 100%) | 6 of 6 (54% to 100%) | 0 of 6 (0% to 46%) | 0 | 0 |',
    '| Group A | 2 | 5 | 0 | 5 | 0 of 5 (0% to 52%) | 5 of 5 (48% to 100%) | 0 of 5 (0% to 52%) | 0 | 0 |',
    '| Group C | 2 | 4 | 0 | 4 | 3 of 4 (19% to 99%) | 3 of 4 (19% to 99%) | 1 of 4 (1% to 81%) | 0 | 0 |',
  ],
  hypothesis: [
    'Claim: Sample sample-1 belongs to group d.',
    'Stated test, before it runs:',
    '    - refuted: the finding is excluded_within_panel: a resolved pair of groups rules d out.',
    'Verdict: refuted.',
    "  Group d is excluded within panel tutorial-panel version 1 for sample-1: Outside this group's spread, and decisive sites favor Group A: 27 of 2 allowed over 900 columns in whole; 41 separating sites covered.",
    '  - a vs d: resolved, favoring a (27 sites for a, 0 for d)',
    '  - Excluded within this panel only: a group the panel lacks could still be the answer',
  ],
  'hypothesis-untestable': [
    "Stated test: none. This can't be tested with the saved data: there is no saved result for sample-3.",
    '  - The saved result profiles/tutorial/results/tutorial-panel-1/sample-3.json has no result: the sample was refused (Only 80 columns align to the reference (minimum 100): probably a different gene or a poor fragment)',
    'Verdict: untestable with this data.',
  ],
  cleanup: [],
}

/** Exit status each step must end with: refusals exit 1 so scripts can stop on them. */
const exitCodes: Record<string, number> = { tamper: 1, 'report-3': 1, 'sanger-failed': 1, 'primers-refused': 1 }

describe('the tutorial', () => {
  it('names every runnable block, and the test knows every step', () => {
    expect(page.match(/```sh\n/g)!.length).toBe(steps.length)
    expect(steps.map((s) => s.name).filter((n) => !NOT_RUN.has(n))).toEqual(Object.keys(expected))
  })

  it('runs end to end, offline, and the page shows what the commands print', () => {
    expect(existsSync(`${repo}packages/cli/dist/index.js`), 'build the CLI first: pnpm build').toBe(true)
    // One shell, so the setup's function and variables carry through. A marker after each step records its exit status.
    // Stderr joins stdout, because progress and refusals are printed there.
    const script = 'exec 2>&1\n' + steps
      .filter((s) => !NOT_RUN.has(s.name))
      .map((s) => `echo "@@@step ${s.name}"\n${s.script}echo "@@@exit $?"`)
      .join('\n')
    // The offline answers load for every command, not only fetch, so nothing in this test can reach the network.
    const output = execFileSync('bash', ['-c', script], { cwd: repo, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import ${offline}` }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 })
    const byStep = new Map([...output.matchAll(/@@@step ([\w-]+)\n([\s\S]*?)@@@exit (\d+)/g)].map((m) => [m[1]!, { text: m[2]!, code: Number(m[3]) }]))
    expect([...byStep.keys()]).toEqual(Object.keys(expected))
    for (const [name, lines] of Object.entries(expected)) {
      const { text, code } = byStep.get(name)!
      expect(code, `${name} exit status`).toBe(exitCodes[name] ?? 0)
      for (const line of lines) {
        expect(text, `${name} output`).toContain(line)
        expect(page, `${name} on the page`).toContain(line)
      }
    }
  }, 120_000)
})
