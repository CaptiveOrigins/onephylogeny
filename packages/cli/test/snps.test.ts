import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseGroups } from '../src/snps'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const cli = `${repo}packages/cli/dist/index.js`
const run = (...a: string[]) => {
  try {
    return { code: 0, stdout: execFileSync('node', [cli, ...a], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string }
    return { code: err.status, stdout: err.stdout, stderr: err.stderr }
  }
}
const vcf = 'fixtures/tutorial/snps.vcf'

describe('parseGroups', () => {
  it('reads CSV with a header in any column order, quotes and blank lines, and JSON, to the same map', () => {
    expect(parseGroups('group,note,sample\n"A",x,a-1\n\nB,,b-1\n')).toEqual({ 'a-1': 'A', 'b-1': 'B' })
    expect(parseGroups('{"a-1": "A", "b-1": "B"}')).toEqual({ 'a-1': 'A', 'b-1': 'B' })
    expect(parseGroups('\uFEFFsample,group\r\na-1,A\r\n')).toEqual({ 'a-1': 'A' })
    expect(parseGroups(readFileSync(`${repo}fixtures/tutorial/snp-groups.csv`, 'utf8'))).toEqual(JSON.parse(readFileSync(`${repo}fixtures/tutorial/snp-groups.json`, 'utf8')))
  })

  it('refuses a CSV without the header, an empty cell, a sample in two groups, and JSON that isn\'t one object of text', () => {
    expect(() => parseGroups('a-1,A\n')).toThrow(/header row with a "sample" and a "group" column/)
    expect(() => parseGroups('sample,group\na-1,\n')).toThrow('Line 2: needs both a sample and a group')
    expect(() => parseGroups('sample,group\na-1,A\na-1,B\n')).toThrow('Line 3: a-1 is already in group A')
    expect(() => parseGroups('["a-1"]')).toThrow(/one object/)
    expect(() => parseGroups('{"a-1": 3}')).toThrow(/needs a group ID/)
    expect(() => parseGroups('{"a-1": ')).toThrow(/isn't valid JSON/)
  })
})

describe('snps on the command line', () => {
  it('prints the comparison as a table, with the samples left out and no probability', () => {
    expect(existsSync(cli), 'build the CLI first: pnpm build').toBe(true)
    const r = run('snps', '--vcf', vcf, '--groups', 'fixtures/tutorial/snp-groups.csv', '--min-shared', '10')
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('VCF: 8 samples, 12 sites used.')
    expect(r.stdout).toContain('Skipped 1 site: filter not PASS (lowQ).')
    expect(r.stdout).toContain('Nearest SNP neighbours all in the same group: 2 of 7. Tied between its own group and another: 1. No neighbour with enough shared sites: 0.')
    expect(r.stdout).toContain('A      3        0 of 3                 1     0.306        0.485')
    expect(r.stdout).toContain('B      4        2 of 4                 0     0.558        0.485')
    expect(r.stdout).toContain('Grouped but not in the VCF: d-1')
    expect(r.stdout).toContain('In the VCF but not grouped: c-1')
    expect(r.stdout).toContain('These are descriptions, not probabilities.')
    expect(r.stdout).not.toMatch(/probability of|likelihood|%/i)
  })

  it('gives the same JSON from CSV and JSON groups, and says none when no pair shares enough sites', () => {
    const csv = run('snps', '--vcf', vcf, '--groups', 'fixtures/tutorial/snp-groups.csv', '--min-shared', '10', '--json')
    const json = run('snps', '--vcf', vcf, '--groups', 'fixtures/tutorial/snp-groups.json', '--min-shared', '10', '--json')
    expect(csv.stdout).toBe(json.stdout)
    const out = JSON.parse(json.stdout)
    expect(out).toMatchObject({ samples: 8, sites: 12, minSharedSites: 10, compared: 7, nearestSameGroup: 2, nearestTied: 1, noNeighbour: 0, notInVcf: ['d-1'], notGrouped: ['c-1'] })
    expect(out.perGroup.map((g: { group: string; samples: number }) => [g.group, g.samples])).toEqual([['A', 3], ['B', 4]])
    // The default needs 100 shared sites; this file has 12, so nothing is measured, and that's said rather than guessed.
    const strict = run('snps', '--vcf', vcf, '--groups', 'fixtures/tutorial/snp-groups.csv')
    expect(strict.stdout).toContain('No neighbour with enough shared sites: 7.')
    expect(strict.stdout).toContain('A      3        0 of 3                 0     none         none')
  })

  it('refuses missing files, a bad --min-shared and a file that isn\'t a VCF, with exit status 1', () => {
    expect(run('snps', '--vcf', vcf)).toMatchObject({ code: 1, stderr: '--vcf and --groups are required\n' })
    expect(run('snps', '--vcf', vcf, '--groups', 'fixtures/tutorial/snp-groups.csv', '--min-shared', '0')).toMatchObject({ code: 1, stderr: '--min-shared must be a whole number of sites, 1 or more\n' })
    expect(run('snps', '--vcf', 'fixtures/tutorial/samples.fasta', '--groups', 'fixtures/tutorial/snp-groups.csv')).toMatchObject({ code: 1, stderr: 'Line 1: Data before the #CHROM header line\n' })
  })
})
