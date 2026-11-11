import type { GroupAgreement, Vcf } from '@captiveorigins/onephylogeny-core'

/**
 * Reads a groups file: sample ID to group ID. JSON is one object (`{"sample": "group"}`); anything else is read as CSV
 * with a header row naming a `sample` and a `group` column (others are ignored). Cells may be wrapped in double quotes,
 * but can't hold commas. A sample listed twice with different groups, an empty cell or a missing column is refused,
 * with its line.
 */
export function parseGroups(text: string): Record<string, string> {
  const body = text.replace(/^\uFEFF/, '').trim()
  if (body.startsWith('{') || body.startsWith('[')) {
    let data: unknown
    try {
      data = JSON.parse(body)
    } catch (e) {
      throw new Error(`The groups file isn't valid JSON: ${(e as Error).message}`)
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The groups JSON must be one object mapping sample IDs to group IDs')
    const out: Record<string, string> = {}
    for (const [sample, group] of Object.entries(data)) {
      if (typeof group !== 'string' || !group.trim()) throw new Error(`Sample "${sample}" needs a group ID as text`)
      out[sample] = group.trim()
    }
    return out
  }
  const lines = body.split(/\r?\n/)
  const cells = (line: string) => line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim())
  const head = cells(lines[0] ?? '').map((c) => c.toLowerCase())
  const si = head.indexOf('sample')
  const gi = head.indexOf('group')
  if (si < 0 || gi < 0) throw new Error('The groups CSV needs a header row with a "sample" and a "group" column')
  const out: Record<string, string> = {}
  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return
    const c = cells(line)
    const sample = c[si]
    const group = c[gi]
    if (!sample || !group) throw new Error(`Line ${i + 2}: needs both a sample and a group`)
    if (sample in out && out[sample] !== group) throw new Error(`Line ${i + 2}: ${sample} is already in group ${out[sample]}`)
    out[sample] = group
  })
  return out
}

const fmt = (x: number | null) => (x === null ? 'none' : x.toFixed(3))

/** `compareWithGroups` as plain text: a summary, one row per group, the samples left out, and what the numbers mean. */
export function snpsTable(vcf: Vcf, result: GroupAgreement, minSharedSites: number): string {
  const lines: string[] = []
  lines.push(`VCF: ${vcf.samples.length} samples, ${vcf.sites.length} sites used.`)
  for (const s of vcf.skipped) lines.push(`Skipped ${s.count} site${s.count === 1 ? '' : 's'}: ${s.reason}.`)
  lines.push(`Compared ${result.compared} samples that have both SNPs and a group. Two samples count as neighbours only if they share at least ${minSharedSites} called sites.`)
  lines.push(`Nearest SNP neighbours all in the same group: ${result.nearestSameGroup} of ${result.compared}. Tied between its own group and another: ${result.nearestTied}. No neighbour with enough shared sites: ${result.noNeighbour}.`)
  lines.push('')
  const rows = [
    ['Group', 'Samples', 'Nearest in same group', 'Tied', 'Mean within', 'Mean between'],
    ...result.perGroup.map((g) => [g.group, String(g.samples), `${g.nearestSameGroup} of ${g.samples}`, String(g.nearestTied), fmt(g.meanWithin), fmt(g.meanBetween)]),
  ]
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)))
  for (const r of rows) lines.push(r.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd())
  lines.push('')
  lines.push(`Grouped but not in the VCF: ${result.notInVcf.length ? result.notInVcf.join(', ') : 'none'}`)
  lines.push(`In the VCF but not grouped: ${result.notGrouped.length ? result.notGrouped.join(', ') : 'none'}`)
  lines.push('')
  lines.push('Distances are the share of differing alleles over the sites both samples have called: 0 is identical, 1 is opposite homozygotes. "none" means no pair shared enough sites to measure.')
  lines.push('These are descriptions, not probabilities. A sample whose nearest neighbour is in another group is not an error: maternal lines and nuclear relatedness can differ for real reasons.')
  return `${lines.join('\n')}\n`
}
