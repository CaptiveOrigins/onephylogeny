import { regionCard, type RegionCardRefusal } from './card.js'
import { conflictText, resultConflicts } from './conflicts.js'
import type { FindingStatus, GeneSummary, Id, Panel, PairFinding, Result } from './model.js'

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
  /** Where the evidence points more than one way (roadmap stage 4). Empty when it doesn't. */
  conflicts: string[]
  /** Panels whose windows are genes only (ADR 0009, decision 5): the genes side by side, in plain words. Counts, never a probability. */
  genes?: {
    summary: string[]
    windows: { gene: string; columns: number; withinSpread: string[]; nearest: string[] }[]
  }
  /** The sequence's quality by named rules, if the result carries it. */
  quality?: { overall: string; rules: string[] }
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The summary across genes in plain words. It lays the genes side by side and counts; it adds nothing up. */
function geneLines(s: GeneSummary, label: (id: Id) => string): NonNullable<SampleReport['genes']> {
  const gene = new Map(s.windows.map((w) => [w.window, w.label]))
  const genes = (ids: Id[]) => ids.map((id) => gene.get(id) ?? String(id)).join(', ')
  const summary: string[] = []
  if (!s.comparedWindows) summary.push(`No gene of the ${s.geneWindows} in this panel could be compared with this sequence.`)
  else {
    summary.push(`Compared in ${s.comparedWindows} of ${s.geneWindows} genes, over ${s.columns} reference columns (a column in two overlapping genes counted once). This sequence has a base at ${s.queryColumns} of them.`)
    if (s.nearest.length) {
      const tie = s.windows.some((w) => w.nearest.length > 1)
      summary.push(`Nearest group in each gene, by differences per shared column: ${s.nearest.map((n) => `${label(n.group)} in ${plural(n.windows.length, 'gene')} (${genes(n.windows)})`).join('; ')}.${tie ? ' A gene where groups tie counts for each of them.' : ''}`)
    }
    if (s.disagreeing.length) summary.push(`These genes point to different nearest groups: ${genes(s.disagreeing)}.`)
    else if (s.comparedWindows > 1) summary.push('The compared genes don\'t disagree: each shares a nearest group with every other.')
  }
  summary.push('These are counts of genes, not a probability or a score. The genes of one mitogenome are inherited together, so genes that agree are not independent tests.')
  return {
    summary,
    windows: s.windows.map((w) => ({ gene: w.label, columns: w.sharedColumns, withinSpread: w.withinSpread.map(label), nearest: w.nearest.map(label) })),
  }
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
    conflicts: resultConflicts(result).map((c) => conflictText(c, label)),
    ...(result.geneSummary ? { genes: geneLines(result.geneSummary, label) } : {}),
    ...(result.qc ? { quality: { overall: result.qc.overall, rules: result.qc.rules.map((q) => `${q.rule}: ${q.status}. ${q.detail}`) } } : {}),
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
  if (r.genes) {
    out.push('', '## Across genes', '', ...r.genes.summary.flatMap((s) => [s, '']))
    if (r.genes.windows.length) {
      out.push('| Gene | Columns compared | Within the group\'s spread | Nearest |', '| --- | --- | --- | --- |')
      for (const w of r.genes.windows) out.push(`| ${cell(w.gene)} | ${w.columns} | ${cell(w.withinSpread.join(', ') || 'none')} | ${cell(w.nearest.join(', '))} |`)
    } else out.pop()
  }
  if (r.quality) out.push('', '## Sequence quality', '', `Overall: ${r.quality.overall}. These describe the sequence and don't change any status.`, '', ...r.quality.rules.map((q) => `- ${q}`))
  if (r.conflicts.length) out.push('', '## Conflicting evidence', '', ...r.conflicts.map((c) => `- ${c}`))
  if (r.gaps.length) out.push('', '## Gaps and caveats', '', ...r.gaps.map((g) => `- ${g}`))
  const v = r.versions
  out.push('', '## Versions', '', `- Panel: ${v.panel} (${v.panelStatus}), checksum \`${v.checksum}\``, `- Sample: ${v.query}${v.querySha256 ? `, sequence \`${v.querySha256}\`` : ''}`, `- Run: ${v.run}`)
  if (v.producedBy.length) out.push(`- Software: ${v.producedBy.join(', ')}`)
  if (r.citations.length) out.push('', '## Sources', '', ...r.citations.map((c) => `- ${c}`))
  return `${out.join('\n')}\n`
}
