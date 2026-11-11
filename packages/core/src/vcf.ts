/**
 * SNP data from a prepared VCF (roadmap stage 6.4, task K198): read genotypes, and compare what they say about
 * relatedness with the groups a mitochondrial panel gives the same animals. Description only: no probabilities, and a
 * missing genotype is never a difference.
 */

export class VcfError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `Line ${line}: ${message}` : message)
    this.name = 'VcfError'
  }
}

/** One variant. `genotypes[i]` lists sample i's allele indices (0 = REF), or null when missing. */
export type VcfSite = { chrom: string; pos: number; ref: string; alt: string[]; filter: string; genotypes: (number[] | null)[] }
export type Vcf = { samples: string[]; sites: VcfSite[]; skipped: { reason: string; count: number }[] }

/**
 * Reads a VCF's header, sample names and GT field. Sites that didn't pass the file's own filter are skipped and counted,
 * not silently dropped. A file without a `#CHROM` header, a row with the wrong number of columns, or a malformed GT is
 * refused with its line number.
 */
export function parseVcf(text: string, options: { passOnly?: boolean } = {}): Vcf {
  const passOnly = options.passOnly ?? true
  const lines = text.split(/\r?\n/)
  let samples: string[] | null = null
  const sites: VcfSite[] = []
  const skipped = new Map<string, number>()
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
  lines.forEach((line, i) => {
    if (!line || line.startsWith('##')) return
    if (line.startsWith('#CHROM')) {
      const cols = line.split('\t')
      if (cols.length < 8) throw new VcfError('The #CHROM header has fewer than 8 columns', i + 1)
      samples = cols.length > 9 ? cols.slice(9) : []
      return
    }
    if (!samples) throw new VcfError('Data before the #CHROM header line', i + 1)
    const cols = line.split('\t')
    if (cols.length !== 9 + samples.length) throw new VcfError(`Expected ${9 + samples.length} columns, found ${cols.length}`, i + 1)
    const [chrom, pos, , ref, alt, , filter, , format] = cols as [string, string, string, string, string, string, string, string, string]
    if (passOnly && filter !== 'PASS' && filter !== '.') return skip(`filter not PASS (${filter})`)
    const gtAt = format.split(':').indexOf('GT')
    if (gtAt < 0) return skip('no GT field')
    const alts = alt === '.' ? [] : alt.split(',')
    const genotypes = cols.slice(9).map((cell) => {
      const gt = cell.split(':')[gtAt] ?? '.'
      if (/^\.([/|]\.)*$/.test(gt)) return null
      if (!/^\d+([/|]\d+)*$/.test(gt)) throw new VcfError(`Unreadable genotype "${gt}"`, i + 1)
      const alleles = gt.split(/[/|]/).map(Number)
      if (alleles.some((a) => a > alts.length)) throw new VcfError(`Genotype "${gt}" names an allele the site doesn't have`, i + 1)
      return alleles
    })
    sites.push({ chrom, pos: Number(pos), ref, alt: alts, filter, genotypes })
  })
  if (!samples) throw new VcfError('No #CHROM header line: this is not a VCF')
  return { samples, sites, skipped: [...skipped].map(([reason, count]) => ({ reason, count })) }
}

/**
 * Genotype distance between two samples: the mean share of differing alleles over sites where both are called
 * (0 for identical genotypes, 1 for opposite homozygotes), with the number of shared sites. Null with no shared site:
 * no shared data means no measurement, not zero.
 */
export function genotypeDistance(vcf: Vcf, a: number, b: number): { distance: number | null; sharedSites: number } {
  let total = 0
  let shared = 0
  for (const s of vcf.sites) {
    const x = s.genotypes[a]
    const y = s.genotypes[b]
    if (!x || !y || x.length !== y.length) continue
    const count = (g: number[]) => g.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>())
    const cx = count(x)
    const cy = count(y)
    let same = 0
    for (const [allele, n] of cx) same += Math.min(n, cy.get(allele) ?? 0)
    total += (x.length - same) / x.length
    shared++
  }
  return { distance: shared ? total / shared : null, sharedSites: shared }
}

export type GroupAgreement = {
  /** Samples in both the VCF and the group list. */
  compared: number
  /** Samples whose nearest SNP neighbours (with at least `minSharedSites`) are all in the same mitochondrial group. */
  nearestSameGroup: number
  /**
   * Samples whose nearest neighbours tie between their own group and another. Counted apart, never settled by file
   * order: a tie says the SNPs don't choose.
   */
  nearestTied: number
  /** Samples with no neighbour sharing enough sites: counted, never guessed. */
  noNeighbour: number
  perGroup: { group: string; samples: number; nearestSameGroup: number; nearestTied: number; meanWithin: number | null; meanBetween: number | null }[]
  notInVcf: string[]
  notGrouped: string[]
}

/**
 * How the SNP data relate to mitochondrial groups for the same animals: for each sample, whether its nearest SNP
 * neighbour shares its group, and each group's mean distance within and to others. Disagreement isn't an error in
 * either: maternal lineages and nuclear relatedness can differ for real reasons (sex-biased movement, hybridisation).
 */
export function compareWithGroups(vcf: Vcf, groups: Record<string, string>, minSharedSites = 100): GroupAgreement {
  const index = new Map(vcf.samples.map((s, i) => [s, i]))
  const ids = vcf.samples.filter((s) => s in groups)
  const d = new Map<string, number | null>()
  const key = (a: string, b: string) => (a < b ? `${a}\t${b}` : `${b}\t${a}`)
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const r = genotypeDistance(vcf, index.get(ids[i]!)!, index.get(ids[j]!)!)
      d.set(key(ids[i]!, ids[j]!), r.sharedSites >= minSharedSites ? r.distance : null)
    }
  let nearestSameGroup = 0
  let nearestTied = 0
  let noNeighbour = 0
  const outcome = new Map<string, 'same' | 'tied' | 'other'>()
  for (const s of ids) {
    let bestDist = Infinity
    let nearest: string[] = []
    for (const o of ids) {
      if (o === s) continue
      const v = d.get(key(s, o))
      if (v === null || v === undefined) continue
      if (v < bestDist - 1e-12) {
        bestDist = v
        nearest = [o]
      } else if (Math.abs(v - bestDist) <= 1e-12) nearest.push(o)
    }
    if (!nearest.length) {
      noNeighbour++
      continue
    }
    const same = nearest.filter((o) => groups[o] === groups[s]).length
    const result = same === nearest.length ? 'same' : same > 0 ? 'tied' : 'other'
    outcome.set(s, result)
    if (result === 'same') nearestSameGroup++
    else if (result === 'tied') nearestTied++
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const groupIds = [...new Set(ids.map((s) => groups[s]!))].sort()
  const perGroup = groupIds.map((g) => {
    const members = ids.filter((s) => groups[s] === g)
    const within: number[] = []
    const between: number[] = []
    for (const s of members)
      for (const o of ids) {
        if (o === s) continue
        const v = d.get(key(s, o))
        if (v === null || v === undefined) continue
        if (groups[o] === g) {
          if (s < o) within.push(v)
        } else between.push(v)
      }
    return { group: g, samples: members.length, nearestSameGroup: members.filter((s) => outcome.get(s) === 'same').length, nearestTied: members.filter((s) => outcome.get(s) === 'tied').length, meanWithin: mean(within), meanBetween: mean(between) }
  })
  return {
    compared: ids.length,
    nearestSameGroup,
    nearestTied,
    noNeighbour,
    perGroup,
    notInVcf: Object.keys(groups).filter((s) => !index.has(s)).sort(),
    notGrouped: vcf.samples.filter((s) => !(s in groups)),
  }
}
