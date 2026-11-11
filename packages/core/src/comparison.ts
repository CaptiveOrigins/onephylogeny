import { canonicalJson } from './panel.js'
import { compareRuns, type ClaimComparison, type RunComparison } from './compare.js'
import type { Panel } from './model.js'
import type { ClaimReport, CountInterval, OutcomeRow, PerWindowReport, StudyOutReport } from './validation.js'

/**
 * Two panel versions side by side, in words a reader can follow without opening a file: what `compareRuns` finds, plus
 * each version's validation outcomes by window, paired row by row. Nothing here is combined into a score or picks a
 * version, because choosing the best-looking run after comparing isn't a test.
 */

/** The parts of a stored validation report a comparison reads. Older reports may lack any of them. */
export type ValidationForComparison = { claims?: ClaimReport[]; windows?: PerWindowReport; studyOut?: StudyOutReport }

/** `site` is leave-one-site-out by window; `study` is leave-one-study-out by window, summed over studies. */
export type OutcomeScheme = 'site' | 'study'

/** One group in one window under one scheme, as each version reported it. Null where a version has no such row. */
export type OutcomePair = { scheme: OutcomeScheme; window: string; group: string; a: OutcomeRow | null; b: OutcomeRow | null; same: boolean }

export type OutcomeComparison = {
  pairs: OutcomePair[]
  /** Outcome reports one version has and the other doesn't, usually because it was built before they existed. */
  missing: { side: 'a' | 'b'; scheme: OutcomeScheme }[]
}

export type PanelComparison = {
  runs: RunComparison
  outcomes: OutcomeComparison
  /** Display names from both panels, so a reader sees "Group A" and not an id. A panel's own label wins over the other's. */
  labels: { groups: Record<string, string>; windows: Record<string, string> }
}

const SCHEMES: OutcomeScheme[] = ['site', 'study']

function outcomeRows(v: ValidationForComparison | undefined, scheme: OutcomeScheme): Map<string, OutcomeRow> | null {
  const rows = scheme === 'site' ? v?.windows?.windows.flatMap((w) => w.rows) : v?.studyOut?.totals
  return rows ? new Map(rows.map((r) => [`${r.window}|${r.group}`, r])) : null
}

/** Pairs each version's outcome rows by scheme, window and group. Only pairs, never subtracts: two intervals aren't a difference. */
export function compareOutcomes(a?: ValidationForComparison, b?: ValidationForComparison): OutcomeComparison {
  const pairs: OutcomePair[] = []
  const missing: OutcomeComparison['missing'] = []
  for (const scheme of SCHEMES) {
    const x = outcomeRows(a, scheme)
    const y = outcomeRows(b, scheme)
    if (x && !y) missing.push({ side: 'b', scheme })
    if (y && !x) missing.push({ side: 'a', scheme })
    for (const k of new Set([...(x?.keys() ?? []), ...(y?.keys() ?? [])])) {
      const s = x?.get(k) ?? null
      const t = y?.get(k) ?? null
      const ref = (s ?? t)!
      pairs.push({ scheme, window: ref.window, group: ref.group, a: s, b: t, same: Boolean(s && t) && canonicalJson(s) === canonicalJson(t) })
    }
  }
  return { pairs, missing }
}

/** Everything a reader needs to compare two built versions. `compareRuns` does the record and claim work unchanged. */
export function comparePanels(a: Panel, b: Panel, va?: ValidationForComparison, vb?: ValidationForComparison): PanelComparison {
  const groups: Record<string, string> = {}
  const windows: Record<string, string> = {}
  for (const p of [b, a]) {
    for (const g of p.groups) groups[g.id] = g.label ?? g.id
    for (const w of p.windows) windows[w.id] = w.label ?? w.id
  }
  for (const v of [vb, va]) for (const w of v?.windows?.windows ?? []) windows[w.window] ??= w.label
  return { runs: compareRuns(a, b, va?.claims, vb?.claims), outcomes: compareOutcomes(va, vb), labels: { groups, windows } }
}

// Plain words shared by the Markdown export and the React view, so the two can't drift apart.

export const CLAIM_CHANGE_TEXT: Record<ClaimComparison['change'], string> = {
  same: 'Same', gained: 'Now passes', lost: 'No longer passes', changed: 'Same outcome, different report', 'only-a': 'Only in A', 'only-b': 'Only in B', unknown: 'Not known',
}

/** "12 of 14 (61% to 98%)": a count out of its tests, with its interval. Never a bare rate. */
export const countText = (c?: CountInterval) => (c ? `${c.count} of ${c.of} (${Math.round(c.lower * 100)}% to ${Math.round(c.upper * 100)}%)` : 'No tests')

const label = (map: Record<string, string>, id: string) => map[id] ?? id

export const claimName = (c: Pick<ClaimComparison, 'a' | 'b' | 'window'>, labels: PanelComparison['labels']) => `${label(labels.groups, c.a)} vs ${label(labels.groups, c.b)}, ${label(labels.windows, c.window)}`

/** One side of a claim: whether it passed, what stopped it, and the sites and records each group brought. */
export function claimStateText(s: ClaimComparison['before'], c: Pick<ClaimComparison, 'a' | 'b'>, labels: PanelComparison['labels']): string {
  if (!s) return 'No report'
  const head = s.passed ? 'Passed' : `Failed at the ${s.failedGate ?? 'unnamed'} gate`
  return `${head}. ${label(labels.groups, c.a)}: ${s.sites.a} sites, ${s.records.a} records. ${label(labels.groups, c.b)}: ${s.sites.b} sites, ${s.records.b} records.`
}

export const gateChangeText = (g: { gate: string; before: string | null; after: string | null }) =>
  `${g.gate} gate. A: ${g.before === null ? 'not run' : g.before || 'no detail'}. B: ${g.after === null ? 'not run' : g.after || 'no detail'}.`

/** Report fields that differ beyond the gates, leaving out those both sides' text already shows. */
export const otherFieldsShown = (c: ClaimComparison) => c.otherFields.filter((f) => !['passed', 'sites', 'records'].includes(f))

export const schemeText = (s: OutcomeScheme) => (s === 'site' ? 'holding out each site' : 'holding out each study')

const records = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`

/** Records a version left out after results were seen, and how many of them the other version still has. */
export const postHocText = (p: RunComparison['postHoc'][number], c: RunComparison) =>
  `Version ${p.side === 'a' ? c.a.version : c.b.version} left out ${records(p.omitted.length)} after results were seen: ${p.omitted.join(', ')}. The other version has ${p.inOtherSide.length} of them.`

/** Everything to read before the rest: post hoc omissions, missing reports and the notes `compareRuns` makes. */
export const warningsText = (c: PanelComparison) => [...c.runs.postHoc.map((p) => postHocText(p, c.runs)), ...c.runs.notes, ...c.outcomes.missing.map((m) => missingOutcomeText(m, c.runs))]

/** The version's own words: from a Study or not, and how many records it left out after results were seen. */
export function sideText(s: RunComparison['a']): string {
  const n = s.study?.postHocOmitted.length ?? 0
  const from = s.study ? `From Study "${s.study.title}"${n ? `, with ${records(n)} left out after results were seen` : ''}.` : 'Not from a Study.'
  return `${from} ${s.hasValidation ? 'Has a validation report.' : 'Has no usable validation report.'}`
}

export function recordsText(r: RunComparison['records']): string {
  return `${r.shared} records in both, ${r.onlyA.length} only in A, ${r.onlyB.length} only in B. ${r.changedGroup.length} of the shared records changed group.`
}

export function claimsText(c: RunComparison): string {
  const n = c.claims.length
  const same = c.claims.filter((x) => x.change === 'same').length
  return `${n} ${n === 1 ? 'claim' : 'claims'}, each one pair of groups in one window. ${same} of them ${same === 1 ? 'is' : 'are'} the same in both versions.`
}

export function settingsText(c: RunComparison): string {
  const settings = c.settings.length ? `These differ, so changes may not come from the records alone: ${c.settings.join(', ')}.` : 'Settings are the same.'
  return `${settings} ${c.sameSequences ? 'The aligned sequences are identical.' : 'The aligned sequences differ.'}`
}

export const missingOutcomeText = (m: OutcomeComparison['missing'][number], c: RunComparison) =>
  `Version ${m.side === 'a' ? c.a.version : c.b.version} has no outcomes ${schemeText(m.scheme)}, probably because it was built before they were reported, so those rows show only the other version.`

const cell = (s: string | number) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** One version's row as table cells, in `OUTCOME_COLUMNS` order. */
export const outcomeCells = (r: OutcomeRow | null) =>
  r ? [r.records, r.notTestable, r.sites, countText(r.namedTruth), countText(r.truthKept), countText(r.wrong), r.outcomes.unresolved, r.outcomes.notEvaluable] : ['Not in this version', '–', '–', '–', '–', '–', '–', '–']

export const OUTCOME_COLUMNS = ['Records', 'Not testable', 'Sites', 'Named the true group', 'Kept the true group', 'Wrong', 'Unresolved', 'Not evaluable'] as const

/** Outcome pairs grouped into one table per scheme and window, in report order. */
export function outcomeTables(o: OutcomeComparison): { scheme: OutcomeScheme; window: string; pairs: OutcomePair[] }[] {
  const out = new Map<string, { scheme: OutcomeScheme; window: string; pairs: OutcomePair[] }>()
  for (const p of o.pairs) {
    const k = `${p.scheme}|${p.window}`
    if (!out.has(k)) out.set(k, { scheme: p.scheme, window: p.window, pairs: [] })
    out.get(k)!.pairs.push(p)
  }
  return [...out.values()]
}

/** The comparison as Markdown: readable as plain text, and without the tool. */
export function comparisonMarkdown(c: PanelComparison): string {
  const { runs: r, labels } = c
  const out: string[] = [`# ${r.a.id} ${r.a.version} compared with ${r.b.id} ${r.b.version}`, '', 'What differs between the two versions. It doesn\'t say which is better: choosing the best-looking run after comparing isn\'t a test.', '', '## Versions', '']
  out.push(`- A: version ${r.a.version}, checksum \`${r.a.checksum}\`. ${sideText(r.a)}`, `- B: version ${r.b.version}, checksum \`${r.b.checksum}\`. ${sideText(r.b)}`)
  const warnings = warningsText(c)
  if (warnings.length) out.push('', '## Read this first', '', ...warnings.map((n) => `- ${n}`))
  out.push('', '## Settings', '', settingsText(r))
  const rec = r.records
  out.push('', '## Records', '', recordsText(rec))
  if (rec.onlyA.length) out.push('', `Only in A: ${rec.onlyA.join(', ')}.`)
  if (rec.onlyB.length) out.push('', `Only in B: ${rec.onlyB.join(', ')}.`)
  if (rec.changedGroup.length) {
    out.push('', '| Record | Group in A | Group in B |', '| --- | --- | --- |')
    for (const x of rec.changedGroup) out.push(`| ${cell(x.record)} | ${cell(label(labels.groups, x.a))} | ${cell(label(labels.groups, x.b))} |`)
  }
  for (const f of rec.changedEvidence) {
    out.push('', `### ${f.records.length} ${f.records.length === 1 ? 'record' : 'records'} changed ${f.field}`, '', '| Record | A | B |', '| --- | --- | --- |')
    for (const x of f.records) out.push(`| ${cell(x.record)} | ${cell(x.a ?? 'None')} | ${cell(x.b ?? 'None')} |`)
  }
  out.push('', '## Claims', '', claimsText(r))
  const changed = r.claims.filter((x) => x.change !== 'same')
  if (changed.length) {
    out.push('', '| Claim | Change | A | B |', '| --- | --- | --- | --- |')
    for (const x of changed) out.push(`| ${cell(claimName(x, labels))} | ${CLAIM_CHANGE_TEXT[x.change]} | ${cell(claimStateText(x.before, x, labels))} | ${cell(claimStateText(x.after, x, labels))} |`)
    const details = changed.flatMap((x) => [...x.gates.map((g) => `- ${claimName(x, labels)}: ${gateChangeText(g)}`), ...(otherFieldsShown(x).length ? [`- ${claimName(x, labels)}: also differs in ${otherFieldsShown(x).join(', ')}.`] : [])])
    if (details.length) out.push('', ...details)
  }
  const tables = outcomeTables(c.outcomes)
  out.push('', '## Validation outcomes', '')
  if (!tables.length) out.push('Neither version has outcomes by window.')
  else {
    out.push('Each version\'s own counts, side by side. Each count is out of its tests, with an exact 95% interval; tests from one site or study aren\'t independent, so the true uncertainty is wider. Two intervals that overlap don\'t show the versions differ.')
    for (const t of tables) {
      const changedRows = t.pairs.filter((p) => !p.same).map((p) => label(labels.groups, p.group))
      out.push('', `### ${label(labels.windows, t.window)}, ${schemeText(t.scheme)}`, '', changedRows.length ? `Differs for ${changedRows.join(', ')}.` : 'The same in both versions.', '')
      out.push(`| Group | Version | ${OUTCOME_COLUMNS.join(' | ')} |`, `| --- | --- | ${OUTCOME_COLUMNS.map(() => '---').join(' | ')} |`)
      for (const p of t.pairs) for (const [v, row] of [[r.a.version, p.a], [r.b.version, p.b]] as const) out.push(`| ${cell(label(labels.groups, p.group))} | ${cell(v)} | ${outcomeCells(row).map(cell).join(' | ')} |`)
    }
  }
  out.push('', 'These are counts on a reference panel, not calibrated probabilities, and there is no overall score.')
  return `${out.join('\n')}\n`
}
