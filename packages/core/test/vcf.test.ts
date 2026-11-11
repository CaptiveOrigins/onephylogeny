import { describe, expect, it } from 'vitest'

import { compareWithGroups, genotypeDistance, parseVcf, VcfError } from '../src'

const header = '##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT'
const vcf = (samples: string[], rows: string[]) => [header + (samples.length ? '\t' + samples.join('\t') : ''), ...rows].join('\n') + '\n'
const row = (pos: number, filter: string, gts: string[]) => ['c1', pos, '.', 'A', 'G', '50', filter, '.', 'GT:DP', ...gts.map((g) => `${g}:10`)].join('\t')

describe('parseVcf', () => {
  it('reads samples and genotypes, keeps missing as null, and counts filtered sites', () => {
    const v = parseVcf(vcf(['a', 'b', 'c'], [row(1, 'PASS', ['0/0', '0/1', './.']), row(2, 'lowQ', ['1/1', '1/1', '1/1']), row(3, '.', ['1|1', '0|1', '0/0'])]))
    expect(v.samples).toEqual(['a', 'b', 'c'])
    expect(v.sites.map((s) => s.pos)).toEqual([1, 3])
    expect(v.sites[0]!.genotypes).toEqual([[0, 0], [0, 1], null])
    expect(v.skipped).toEqual([{ reason: 'filter not PASS (lowQ)', count: 1 }])
  })

  it('refuses what isn\'t a VCF, wrong column counts, and bad genotypes, with the line', () => {
    expect(() => parseVcf('ACGT\n')).toThrow(VcfError)
    expect(() => parseVcf(vcf(['a', 'b'], [row(1, 'PASS', ['0/0'])]))).toThrow(/Line 3: Expected 11 columns/)
    expect(() => parseVcf(vcf(['a'], [row(1, 'PASS', ['0/x'])]))).toThrow(/Unreadable genotype/)
    expect(() => parseVcf(vcf(['a'], [row(1, 'PASS', ['0/2'])]))).toThrow(/allele the site doesn't have/)
  })
})

describe('genotypeDistance', () => {
  it('scores identical 0, heterozygote half, opposite homozygotes 1, and never counts a missing call', () => {
    const v = parseVcf(vcf(['a', 'b', 'c', 'd'], [row(1, 'PASS', ['0/0', '0/0', '0/1', './.']), row(2, 'PASS', ['0/0', '1/1', '0/1', './.'])]))
    expect(genotypeDistance(v, 0, 1)).toEqual({ distance: 0.5, sharedSites: 2 })
    expect(genotypeDistance(v, 0, 2)).toEqual({ distance: 0.5, sharedSites: 2 })
    expect(genotypeDistance(v, 0, 3)).toEqual({ distance: null, sharedSites: 0 })
  })
})

describe('compareWithGroups', () => {
  // Two made-up populations: group X carries REF at every site, group Y ALT, with one Y animal carrying X's genotypes
  // (a nuclear-mitochondrial mismatch on purpose) and one animal with nothing called.
  const n = 120
  const gts = (s: string) => (s.startsWith('x') || s === 'y3' ? '0/0' : s === 'gap' ? './.' : '1/1')
  const samples = ['x1', 'x2', 'x3', 'y1', 'y2', 'y3', 'gap', 'extra']
  const text = vcf(samples, Array.from({ length: n }, (_, i) => row(i + 1, 'PASS', samples.map(gts))))
  const v = parseVcf(text)
  const groups = { x1: 'X', x2: 'X', x3: 'X', y1: 'Y', y2: 'Y', y3: 'Y', gap: 'Y', missing: 'X' }

  it('counts nearest neighbours in the same group, says which animals disagree, and leaves the uncalled one out', () => {
    const r = compareWithGroups(v, groups)
    expect(r.compared).toBe(7)
    expect(r.noNeighbour).toBe(1)
    // y3 carries X's genotypes, so each X animal is equally close to the other X animals and to y3: a tie, counted
    // apart rather than settled by file order. y1 and y2 agree; y3's nearest are all X.
    expect(r.nearestSameGroup).toBe(2)
    expect(r.nearestTied).toBe(3)
    expect(r.notInVcf).toEqual(['missing'])
    expect(r.notGrouped).toEqual(['extra'])
    const y = r.perGroup.find((g) => g.group === 'Y')!
    expect(y.samples).toBe(4)
    expect(y.nearestSameGroup).toBe(2)
    expect(r.perGroup.find((g) => g.group === 'X')).toMatchObject({ nearestSameGroup: 0, nearestTied: 3, meanWithin: 0 })
  })

  it('gives the same counts whatever order the animals are in the file', () => {
    const reversed = [...samples].reverse()
    const text2 = vcf(reversed, Array.from({ length: n }, (_, i) => row(i + 1, 'PASS', reversed.map(gts))))
    const a = compareWithGroups(v, groups)
    const b = compareWithGroups(parseVcf(text2), groups)
    expect([b.nearestSameGroup, b.nearestTied, b.noNeighbour]).toEqual([a.nearestSameGroup, a.nearestTied, a.noNeighbour])
  })

  it('needs enough shared sites before two animals count as neighbours', () => {
    expect(compareWithGroups(v, groups, n + 1).noNeighbour).toBe(7)
  })
})
