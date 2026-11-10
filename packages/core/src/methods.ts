import type { Panel } from './model.js'

/**
 * Methods text for a panel (roadmap stage 5): what a reader needs to describe or repeat it, in plain prose, generated only
 * from what the sealed panel records. It states the rules as configured values, never as probabilities, and lists the
 * panel's limits and sources. Nothing here comes from a person's notes, so it can't drift from what the panel did.
 */
export function panelMethods(panel: Panel): { text: string; citations: string[] } {
  const marker = panel.marker.kind === 'gene' ? `the ${panel.marker.gene} gene${panel.marker.organelle ? ` (${panel.marker.organelle})` : ''}` : panel.marker.kind === 'mitogenome' ? 'the mitochondrial genome' : 'SNPs'
  const taxa = panel.taxa.map((t) => (t.source === 'ncbi-taxonomy' ? `NCBI Taxonomy ${t.id}` : `${t.source} ${t.id}`)).join(', ')
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const records = new Set(panel.groups.flatMap((g) => g.evidence.map((e) => e.record))).size
  const g = panel.gates
  const r = panel.rules
  const code = panel.reference.geneticCode ? `, with reading frame checked under genetic code ${panel.reference.geneticCode}` : ''
  const windows = panel.windows.map((w) => `${w.label} (columns ${w.start + 1}–${w.end})`).join(' and ')
  const confirmatory = panel.claims.filter((c) => c.basis === 'confirmatory').length
  const paragraphs = [
    `Reference panel ${panel.id} ${panel.version} (status: ${panel.status}; checksum ${panel.checksum ?? 'unsealed'}) covers ${marker} of ${taxa}. It holds ${n(records, 'record')} in ${n(panel.groups.length, 'group')}, aligned to reference ${panel.reference.accession} (${panel.reference.length} columns)${code}.`,
    `Records were accepted only if at least ${g.minAlignedColumns} columns aligned to the reference at ${Math.round(g.minIdentity * 100)}% identity or more${g.frameErrors ? ', with no frame-shifting indel or in-frame stop' : ''}.${panel.numtCopies?.length ? ` Samples are compared with ${n(panel.numtCopies.length, 'nuclear copy', 'nuclear copies')} of the marker found in a genome screen, and flagged for review if closer to one.` : ' No nuclear-copy screen was sealed into this panel.'} Gaps are treated as missing data.`,
    `Comparisons use ${windows || 'the whole marker as one window'}. A column counts for a group only where it has at least ${n(r.minDepthPerColumn, 'record')}, and a group is compared only over at least ${n(r.minSharedColumns, 'shared column')}. A group is ruled out only where at least ${n(r.minBlocksForExclusion, 'independent sampling site')} disagree, and two groups are told apart only by at least ${n(r.minDecisiveSites, 'decisive site')} with none against. A sequence may differ by up to ${n(r.tolerance, 'difference')} beyond a group's own spread, scaled to the columns compared, and still fit it. These are configured values, not calibrated probabilities.`,
    panel.claims.length
      ? `${n(panel.claims.length, 'pairwise claim')} passed validation (${confirmatory} confirmatory, ${panel.claims.length - confirmatory} exploratory): ${panel.validatedScope.join('; ')}.`
      : 'No claim has passed validation, so every result from this panel is exploratory.',
    panel.notCovered.length ? `The panel does not cover: ${panel.notCovered.join(', ')}.` : 'The panel states nothing about what it does not cover.',
    `A result is a statement about the maternal line, never proof of where an animal was collected.${panel.builtWith?.length ? ` Built with ${panel.builtWith.map((t) => `${t.name} ${t.version}`).join(', ')}.` : ''}`,
  ]
  return { text: `${paragraphs.join('\n\n')}\n`, citations: panel.sources.map((s) => (s.url ? `${s.citation} ${s.url}` : s.citation)) }
}
