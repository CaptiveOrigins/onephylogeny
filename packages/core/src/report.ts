import { regionCard, type RegionCardRefusal } from './card.js'
import type { FindingStatus, Id, Panel, PairFinding, Result } from './model.js'

/**
 * A self-contained report for one sample (roadmap stage 2, item 3): the conclusion, the reasons, what was covered, what
 * wasn't, the versions behind it and the sources to cite. Built from the panel and the result alone, so anyone holding
 * those two files gets the same report. It names regions only where the region card would, with the card's own words
 * and caveat; it never shows a coordinate, a site or a record's place.
 */
export type SampleReport = {
  title: string
  conclusion: { regionNamed: boolean; text: string; label?: string; caveat: string }
  groups: { id: Id; label: string; status: FindingStatus; statusText: string; reason: string; columnsCompared: number }[]
  comparisons: { pair: string; outcome: string }[]
  coverage: { columnsCompared: number; notEvaluated: string[] }
  gaps: string[]
  versions: { panel: string; checksum: string; panelStatus: string; run: Id; query: Id; querySha256?: string; producedBy: string[] }
  citations: string[]
}

const STATUS_TEXT: Record<FindingStatus, string> = {
  consistent: 'Consistent',
  excluded_within_panel: 'Ruled out within this panel',
  not_evaluable: "Couldn't be compared",
  inconclusive: 'Inconclusive',
}

/** Why no region is named, in plain words. The codes are the region card's. */
export const NO_REGION_TEXT: Record<RegionCardRefusal, string> = {
  'wrong-panel': 'This result was made with a different panel or version, so it is not read against this one.',
  'not-opted-in': 'Regions are not shown publicly for this animal.',
  'panel-not-current': 'This panel is no longer current, so its results name no region.',
  'candidate-not-shown': 'This panel has not been reviewed yet, so its results name no region.',
  'made-against-other-status': "The panel's recorded status doesn't fit this result, so no region is named.",
  'no-single-match': 'The sequence fits no single group, so no region can be named.',
  'outside-validated-scope': 'This result falls outside what the panel has been validated for, so no region is named.',
  'no-located-records': "The matching group has no record that shows where it occurs.",
  'no-region': 'The matching group has no region name.',
  'region-looks-like-coordinates': 'The region name looks like a position, so it is not shown.',
  'conflicting-comparisons': 'Some comparisons favour another group, so no region is named.',
  'no-resolved-comparison': "The sequence didn't separate the matching group from any other, so no region is named.",
}

const pairOutcome = (p: PairFinding, label: (id: Id) => string): string => {
  if (p.state === 'resolved') return `Favours ${label(p.favors!)} (${p.reasonCode})`
  if (p.state === 'not_evaluable') return `Couldn't be compared (${p.reasonCode})`
  return `Not separated by the columns this sequence covers (${p.reasonCode})`
}

export function sampleReport(panel: Panel, result: Result): SampleReport {
  const label = (id: Id) => panel.groups.find((g) => g.id === id)?.label ?? String(id)
  // The keeper's own view: candidates are shown, labelled exploratory, exactly as the card does for a maintainer's choice.
  const card = regionCard(panel, result, { audience: 'keeper', exploratoryShown: true })
  const conclusion = card.show
    ? { regionNamed: true, text: card.parts.match, ...(card.parts.label ? { label: card.parts.label } : {}), caveat: card.caveat }
    : { regionNamed: false, text: NO_REGION_TEXT[card.reason], caveat: 'A result is a statement about the maternal line, never proof of where an animal was collected.' }
  const notEvaluated = result.candidatesNotEvaluated.map(label)
  return {
    title: `${result.query} against ${panel.id} ${panel.version}`,
    conclusion,
    groups: result.findings.map((f) => ({ id: f.group, label: label(f.group), status: f.status, statusText: STATUS_TEXT[f.status], reason: f.reason, columnsCompared: f.overlap })),
    // "vs", not a slash: group labels often contain one ("North / East").
    comparisons: result.pairs.map((p) => ({ pair: `${label(p.a)} vs ${label(p.b)}`, outcome: pairOutcome(p, label) })),
    coverage: { columnsCompared: result.overlap, notEvaluated },
    // The result's own caveats already say what wasn't evaluated and what the panel doesn't cover, in the evaluator's
    // words; the panel's line is added only for a result made before it did. Exact repeats are dropped.
    gaps: [
      ...new Set([
        ...result.outOfValidatedScope,
        ...(notEvaluated.length ? [`The true group could be one that wasn't evaluated: ${notEvaluated.join(', ')}`] : []),
        ...(result.novelty.flagged ? ["No evaluated group fits this sequence; it may belong to a lineage the panel doesn't have."] : []),
        ...result.caveats,
        ...(panel.notCovered.length ? [`This panel does not cover: ${panel.notCovered.join(', ')}`] : []),
      ]),
    ],
    versions: {
      panel: `${panel.id} ${panel.version}`,
      checksum: result.panel.checksum,
      panelStatus: panel.status,
      run: result.run,
      query: result.query,
      ...(result.querySha256 ? { querySha256: result.querySha256 } : {}),
      producedBy: (result.producedBy ?? []).map((t) => `${t.name} ${t.version}`),
    },
    citations: panel.sources.map((s) => (s.url ? `${s.citation} ${s.url}` : s.citation)),
  }
}

const cell = (s: string | number) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** The report as Markdown: readable as plain text, and without the tool. */
export function reportMarkdown(r: SampleReport): string {
  const out: string[] = [`# ${r.title}`, '', '## Conclusion', '']
  if (r.conclusion.label) out.push(`**${r.conclusion.label}**`, '')
  out.push(r.conclusion.text, '', `*${r.conclusion.caveat}*`, '', '## Groups', '', '| Group | Status | Columns compared | Why |', '| --- | --- | --- | --- |')
  for (const g of r.groups) out.push(`| ${cell(g.label)} | ${cell(g.statusText)} | ${g.columnsCompared} | ${cell(g.reason)} |`)
  if (r.comparisons.length) {
    out.push('', '## Comparisons between groups', '', '| Pair | Outcome |', '| --- | --- |')
    for (const c of r.comparisons) out.push(`| ${cell(c.pair)} | ${cell(c.outcome)} |`)
  }
  out.push('', '## Coverage', '', `${r.coverage.columnsCompared} columns compared.${r.coverage.notEvaluated.length ? ` Not evaluated: ${r.coverage.notEvaluated.join(', ')}.` : ''}`)
  if (r.gaps.length) out.push('', '## Gaps and caveats', '', ...r.gaps.map((g) => `- ${g}`))
  const v = r.versions
  out.push('', '## Versions', '', `- Panel: ${v.panel} (${v.panelStatus}), checksum \`${v.checksum}\``, `- Sample: ${v.query}${v.querySha256 ? `, sequence \`${v.querySha256}\`` : ''}`, `- Run: ${v.run}`)
  if (v.producedBy.length) out.push(`- Software: ${v.producedBy.join(', ')}`)
  if (r.citations.length) out.push('', '## Sources', '', ...r.citations.map((c) => `- ${c}`))
  return `${out.join('\n')}\n`
}
