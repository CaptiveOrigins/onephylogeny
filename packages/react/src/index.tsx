import type { ClaimReport, CountInterval, Finding, FindingStatus, OutcomeRow, PairFinding, Panel, PerWindowReport, Result, RunEvent, StudyOutReport, ValidationReport } from '@captiveorigins/onephylogeny-core'

export type Labels = Partial<Record<FindingStatus, string>>

const STATUS: Record<FindingStatus, { label: string; mark: string }> = {
  consistent: { label: 'Consistent', mark: '●' },
  excluded_within_panel: { label: 'Excluded within this panel', mark: '×' },
  not_evaluable: { label: 'Not evaluable', mark: '–' },
  inconclusive: { label: 'Inconclusive', mark: '?' },
}

export const statusLabel = (status: FindingStatus, labels?: Labels) => labels?.[status] ?? STATUS[status].label

/** A status always has words and a symbol, never color alone. */
export function StatusBadge({ status, labels }: { status: FindingStatus; labels?: Labels }) {
  return <span className={`ophy-status ophy-status-${status}`}><span aria-hidden="true">{STATUS[status].mark}</span> {statusLabel(status, labels)}</span>
}

const groupLabel = (panel: Panel, id: string) => panel.groups.find((g) => g.id === id)?.label ?? id
const ORDER: FindingStatus[] = ['consistent', 'inconclusive', 'excluded_within_panel', 'not_evaluable']

/** The headline in plain words, including when the honest answer is that nothing can be said. */
export function summarizeResult(result: Result, panel: Panel): string {
  const named = (status: FindingStatus) => result.findings.filter((f) => f.status === status).map((f) => groupLabel(panel, f.group))
  const consistent = named('consistent')
  const untested = result.candidatesNotEvaluated.map((g) => groupLabel(panel, g))
  if (result.findings.every((f) => f.status === 'not_evaluable')) return 'Not enough comparable data to evaluate any group'
  const unknown = untested.length ? ` Not evaluated: ${untested.join(', ')}.` : ''
  if (consistent.length === 1) return `Consistent with ${consistent[0]}.${unknown}`
  if (consistent.length) return `Can't separate: ${consistent.join(', ')}.${unknown}`
  if (result.novelty.closest) return `No evaluated group fits. Closest is ${groupLabel(panel, result.novelty.closest)}, which may mean an unsampled population.${unknown}`
  return 'Inconclusive against this panel'
}

/** Coverage across the reference: why a group can or can't be compared with this sample. */
export function CoverageBars({ panel, queryAligned, queryLabel = 'This sample' }: { panel: Panel; queryAligned?: string; queryLabel?: string }) {
  const L = panel.reference.length
  const rowH = 26
  const labelW = 190
  const W = 700
  const x = (p: number) => labelW + (p / L) * (W - labelW - 8)
  const queryWindows: { start: number; end: number }[] = []
  if (queryAligned) {
    let start = -1
    for (let i = 0; i <= queryAligned.length; i++) {
      const has = i < queryAligned.length && /[ACGTRYSWKMBDHVacgt]/.test(queryAligned[i]!)
      if (has && start < 0) start = i
      if (!has && start >= 0) { queryWindows.push({ start, end: i }); start = -1 }
    }
  }
  const rows = [...(queryAligned ? [{ id: '__q', label: queryLabel, windows: queryWindows }] : []), ...panel.groups.map((g) => ({ id: g.id, label: g.label, windows: g.coverage.flatMap((c) => c.columnsAtDepth.map(([start, end]) => ({ start, end }))) }))]
  const H = rows.length * rowH + 24
  return (
    <svg className="ophy-coverage" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Coverage of each group across ${L} reference columns`}>
      {rows.map((r, i) => (
        <g key={r.id} transform={`translate(0 ${i * rowH})`}>
          <text x={labelW - 8} y={16} textAnchor="end" className="ophy-coverage-label">{r.label}</text>
          <rect x={x(0)} y={7} width={x(L) - x(0)} height={12} rx={3} className="ophy-coverage-track" />
          {r.windows.map((w) => <rect key={w.start} x={x(w.start)} y={7} width={Math.max(2, x(w.end) - x(w.start))} height={12} rx={3} className={r.id === '__q' ? 'ophy-coverage-query' : 'ophy-coverage-group'}><title>{`${r.label}: columns ${w.start + 1} to ${w.end}`}</title></rect>)}
        </g>
      ))}
      <text x={x(0)} y={H - 6} className="ophy-coverage-axis">1</text>
      <text x={x(L)} y={H - 6} textAnchor="end" className="ophy-coverage-axis">{L}</text>
    </svg>
  )
}

const PAIR_REASON: Record<PairFinding['reasonCode'], string> = {
  'decisive-sites': 'Decisive sites agree',
  'group-not-evaluable': "At least one group can't be compared here",
  'no-sites-covered': 'This sequence covers no site that separates them',
  'too-few-decisive-sites': 'Too few separating sites covered',
  'sites-disagree': 'Separating sites disagree',
  'thin-group': 'Sites favor one side, but the other has too few independent sites to rule out',
}
const PAIR_STATE: Record<PairFinding['state'], string> = { resolved: 'Resolved', not_resolved: 'Not resolved', not_evaluable: 'Not evaluable' }

/** Whether this sequence separates each pair of groups. "Not resolved" is a real answer. */
export function PairTable({ result, panel }: { result: Result; panel: Panel }) {
  if (!result.pairs.length) return null
  return (
    <table className="ophy-table">
      <thead><tr><th>Pair</th><th>State</th><th>Sites covered</th><th>Why</th></tr></thead>
      <tbody>
        {result.pairs.map((p) => (
          <tr key={`${p.a}|${p.b}`}>
            <th scope="row">{groupLabel(panel, p.a)} / {groupLabel(panel, p.b)}</th>
            <td>{PAIR_STATE[p.state]}{p.favors ? `: favors ${groupLabel(panel, p.favors)}` : ''}</td>
            <td>{p.sitesCovered} ({p.forA} and {p.forB}{p.neither ? `, ${p.neither} neither` : ''})</td>
            <td>{PAIR_REASON[p.reasonCode]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Everything behind a conclusion: each group, its status, and why. */
export function ResultView({ result, panel, queryAligned, labels }: { result: Result; panel: Panel; queryAligned?: string; labels?: Labels }) {
  const findings = [...result.findings].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
  return (
    <section className="ophy-result">
      <h3>{summarizeResult(result, panel)}</h3>
      <p className="ophy-muted">Tested against {panel.id} version {panel.version}, over {result.overlap} columns.</p>
      {result.outOfValidatedScope.length > 0 && <p className="ophy-warning">Outside what this panel has been validated for: {result.outOfValidatedScope.join('. ')}.</p>}
      <CoverageBars panel={panel} {...(queryAligned ? { queryAligned } : {})} />
      <table className="ophy-table">
        <thead><tr><th>Group</th><th>Status</th><th>Why</th><th>Nearest records</th></tr></thead>
        <tbody>
          {findings.map((f: Finding) => (
            <tr key={f.group}>
              <th scope="row">{groupLabel(panel, f.group)}</th>
              <td><StatusBadge status={f.status} {...(labels ? { labels } : {})} /></td>
              <td>{f.reason}</td>
              <td>{f.evidence.join(', ') || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PairTable result={result} panel={panel} />
      {result.novelty.neitherSideSites > 0 && <p className="ophy-muted">{result.novelty.neitherSideSites} separating sites hold a base matching neither group.</p>}
      {result.caveats.length > 0 && <><h4>What this can't tell you</h4><ul className="ophy-caveats">{result.caveats.map((c) => <li key={c}>{c}</li>)}</ul></>}
    </section>
  )
}

/** The calm version for a record page: one conclusion and a link to the detail. */
export function LineageCard({ result, panel, marker, title = 'Maternal lineage', note = 'Not evidence of where this animal was collected.', href }: { result: Result; panel: Panel; marker: string; title?: string; note?: string; href?: string }) {
  return (
    <aside className="ophy-card">
      <div className="ophy-card-title">{title}</div>
      <div className="ophy-card-value">{summarizeResult(result, panel)}</div>
      <div className="ophy-muted">Based on {marker}, compared with panel version {panel.version}. {note}</div>
      {href && <a href={href}>See how we reached this</a>}
    </aside>
  )
}

export function PanelSummary({ panel }: { panel: Panel }) {
  return (
    <section>
      <table className="ophy-table">
        <thead><tr><th>Group</th><th>Region</th><th>Records</th><th>Can show location</th><th>Comparable in</th><th>Records still needed</th></tr></thead>
        <tbody>
          {panel.groups.map((g) => (
            <tr key={g.id}>
              <th scope="row">{g.label}</th>
              <td>{g.region ?? '–'}</td>
              <td>{g.evidence.length}</td>
              <td>{g.evidence.filter((e) => e.use === 'lineage-and-location').length}</td>
              <td>{g.coverage.filter((c) => c.columnsAtDepth.length).map((c) => c.window).join(', ') || 'Nowhere yet'}</td>
              <td>{g.coverage.filter((c) => c.recordsNeeded).map((c) => `${c.recordsNeeded} in ${c.window}`).join(', ') || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CoverageBars panel={panel} />
      <h4>What separates each pair</h4>
      <table className="ophy-table">
        <thead><tr><th>Pair</th><th>Window</th><th>Sites</th><th>Records</th><th>Sites per side</th></tr></thead>
        <tbody>
          {panel.pairs.map((p) => <tr key={`${p.a}|${p.b}|${p.window}`}><th scope="row">{groupLabel(panel, p.a)} / {groupLabel(panel, p.b)}</th><td>{p.window}</td><td>{p.state === 'not_evaluable' ? 'Not evaluable' : p.sites.length}</td><td>{p.records.a} and {p.records.b}</td><td>{p.blocks.a} and {p.blocks.b}</td></tr>)}
        </tbody>
      </table>
      {panel.notCovered.length > 0 && <p><strong>Not covered:</strong> {panel.notCovered.join(', ')}</p>}
      <p className="ophy-muted">Checksum {panel.checksum}</p>
    </section>
  )
}

const pct = (a: number, b: number) => (b ? `${a} of ${b}` : '–')

const SCHEME: Record<ValidationReport['scheme'], string> = {
  'leave-one-record-out': 'Each record (leak check only)',
  'leave-one-haplotype-out': 'Each exact haplotype',
  'leave-one-block-out': 'Each site (the default claim)',
  'leave-one-study-out': 'Each study',
  'leave-one-group-out': 'Each whole group',
}

/** A claim is one pair of groups in one window. Every gate shows, so a failed claim says what stopped it. */
export function ClaimsView({ claims, panel }: { claims: ClaimReport[]; panel?: Panel }) {
  const label = (id: string) => (panel ? groupLabel(panel, id) : id)
  const passed = claims.filter((c) => c.passed)
  return (
    <section>
      <h4>Claims tested</h4>
      <p>{passed.length} of {claims.length} passed every gate. All are exploratory until tested on data that didn't shape this method.</p>
      <table className="ophy-table">
        <thead><tr><th>Pair</th><th>Window</th><th>Sites</th><th>Result</th><th>Stopped by</th></tr></thead>
        <tbody>
          {claims.map((c) => {
            const failed = c.gates.filter((g) => g.ran && !g.passed)
            return <tr key={`${c.a}|${c.b}|${c.window}`}><th scope="row">{label(c.a)} / {label(c.b)}</th><td>{c.window}</td><td>{c.sites.a} and {c.sites.b}</td><td>{c.passed ? `Passed, ${c.minColumns}+ columns` : 'Not validated'}</td><td>{failed.map((g) => g.detail).join('. ') || '–'}</td></tr>
          })}
        </tbody>
      </table>
    </section>
  )
}

/** "12 of 14 (61% to 98%)": a count out of the tests, with its interval. Never a bare rate. */
const counted = (c?: CountInterval) => (c ? `${c.count} of ${c.of} (${Math.round(c.lower * 100)}% to ${Math.round(c.upper * 100)}%)` : 'No tests')

function OutcomeTable({ rows, caption, label }: { rows: OutcomeRow[]; caption: string; label: (id: string) => string }) {
  return (
    <table className="ophy-table">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Group</th><th scope="col">Records</th><th scope="col">Not testable</th><th scope="col">Sites</th><th scope="col">Named</th><th scope="col">True group kept</th><th scope="col">Wrong</th><th scope="col">Unresolved</th><th scope="col">Not evaluable</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.window}|${r.group}`}>
            <th scope="row">{label(r.group)}</th><td>{r.records}</td><td>{r.notTestable}</td><td>{r.sites}</td><td>{counted(r.namedTruth)}</td><td>{counted(r.truthKept)}</td><td>{counted(r.wrong)}</td><td>{r.outcomes.unresolved}</td><td>{r.outcomes.notEvaluable}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Outcomes by window: holding out each site, and each study (analysis protocol, section 9). */
export function OutcomesView({ windows, studyOut, panel }: { windows?: PerWindowReport; studyOut?: StudyOutReport; panel?: Panel }) {
  if (!windows && !studyOut) return null
  const label = (id: string) => (panel ? groupLabel(panel, id) : id)
  const windowLabel = (id: string) => panel?.windows.find((w) => w.id === id)?.label ?? id
  const studyWindows = studyOut ? [...new Set(studyOut.totals.map((r) => r.window))] : []
  return (
    <section>
      <h4>Outcomes by window</h4>
      <p className="ophy-muted">Each test lands in exactly one outcome. Counts come with exact 95% intervals on the number of tests; tests from one site or study aren't independent, so the true uncertainty is wider.</p>
      {windows?.windows.map((w) => (
        <div key={w.window}>
          <OutcomeTable rows={w.rows} caption={`${w.label}, holding out each site (${w.separatingSites} separating column${w.separatingSites === 1 ? '' : 's'})`} label={label} />
          {w.separatingSites === 0 && <p className="ophy-warning">No column in this window separates any two groups, so no result here can name a group.</p>}
        </div>
      ))}
      {studyOut && studyWindows.map((id) => (
        <OutcomeTable key={`study-${id}`} rows={studyOut.totals.filter((r) => r.window === id)} caption={`${windowLabel(id)}, holding out each study (${studyOut.studies.length} studies)`} label={label} />
      ))}
      {studyOut && studyOut.recordsWithoutStudy > 0 && <p className="ophy-muted">{studyOut.recordsWithoutStudy} records name no study, so they stay in every panel and are never tested here.</p>}
      {[...(windows?.diagnostics ?? []), ...(studyOut?.diagnostics ?? [])].filter((d) => d.severity !== 'info').map((d, i) => <p key={`${d.code}-${i}`} className="ophy-warning">{d.message}</p>)}
    </section>
  )
}

export function ValidationView({ blocks, groups, ladder, claims, panel, windows, studyOut }: { blocks: ValidationReport; groups: ValidationReport; ladder?: ValidationReport[]; claims?: ClaimReport[]; panel?: Panel; windows?: PerWindowReport; studyOut?: StudyOutReport }) {
  const noEvidence = groups.groups.reduce((sum, g) => sum + g.notEvaluable, 0)
  return (
    <section>
      <h4>Holding out each sampling site</h4>
      <table className="ophy-table">
        <thead><tr><th>Group</th><th>Sites</th><th>True group consistent</th><th>Only the true group</th><th>Only the true group, all others compared</th><th>True group excluded</th><th>Inconclusive</th><th>Not evaluable</th></tr></thead>
        <tbody>
          {blocks.groups.map((g) => {
            const s = blocks.sites?.find((x) => x.group === g.group)
            return <tr key={g.group}><th scope="row">{g.group}</th><td>{s ? `${s.sitesRight} of ${s.sites} right${s.interval ? `, ${s.interval[0].toFixed(2)} to ${s.interval[1].toFixed(2)}` : ''}` : '–'}</td><td>{pct(g.includedTruth, g.tested)}</td><td>{pct(g.onlyTruth, g.tested)}</td><td>{pct(g.onlyTruthAllEvaluated, g.tested)}</td><td>{pct(g.excludedTruth, g.tested)}</td><td>{pct(g.inconclusive, g.tested)}</td><td>{pct(g.notEvaluable, g.tested)}</td></tr>
          })}
        </tbody>
      </table>
      {blocks.untestedGroups.length > 0 && <p className="ophy-warning">Not tested, because all their records come from one site: {blocks.untestedGroups.join(', ')}.</p>}
      {blocks.diagnostics.map((d) => <p key={d.code} className="ophy-warning">{d.message}</p>)}
      <h4>Removing each whole group</h4>
      <p>{groups.falseConsistent ?? 0} of {groups.tested} records were wrongly called consistent with a remaining group. Lower is better, and this is how the panel behaves when a sample's true population is missing.{noEvidence > 0 ? ` ${noEvidence} of them couldn't be compared with any remaining group, so they say nothing either way.` : ''}</p>
      {ladder && ladder.length > 0 && <>
        <h4>What was held out</h4>
        <p className="ophy-muted">Each row answers a different question, so these are never averaged.</p>
        <table className="ophy-table">
          <thead><tr><th>Held out</th><th>Tested</th><th>True group consistent</th><th>True group excluded</th><th>Not evaluable</th></tr></thead>
          <tbody>{ladder.map((r) => <tr key={r.scheme}><th scope="row">{SCHEME[r.scheme]}</th><td>{r.tested}</td><td>{r.groups.reduce((n, g) => n + g.includedTruth, 0)}</td><td>{r.groups.reduce((n, g) => n + g.excludedTruth, 0)}</td><td>{r.groups.reduce((n, g) => n + g.notEvaluable, 0)}</td></tr>)}</tbody>
        </table>
      </>}
      <OutcomesView {...(windows ? { windows } : {})} {...(studyOut ? { studyOut } : {})} {...(panel ? { panel } : {})} />
      {claims && <ClaimsView claims={claims} {...(panel ? { panel } : {})} />}
      <p className="ophy-muted">These are simple counts on a small reference panel, and they aren't calibrated probabilities.</p>
    </section>
  )
}

export function EventLog({ events }: { events: RunEvent[] }) {
  return (
    <ol className="ophy-log" aria-label="Run log">
      {events.map((e, i) => <li key={i} className={`ophy-log-${e.level}`}><time>{e.at.slice(11, 19)}</time> <span className="ophy-log-step">{e.step}</span> {e.message}</li>)}
    </ol>
  )
}

export type TreeNode = { label: string; length: number; children: TreeNode[] }

/** Reads Newick for display only. Science lives elsewhere: a tree exported to OneTaxonomy uses its parser and checks. */
export function parseNewickForDisplay(text: string): TreeNode {
  let i = 0
  const s = text.trim().replace(/;$/, '')
  const node = (): TreeNode => {
    const children: TreeNode[] = []
    if (s[i] === '(') {
      i++
      children.push(node())
      while (s[i] === ',') { i++; children.push(node()) }
      if (s[i] !== ')') throw new Error('Unbalanced Newick text')
      i++
    }
    let label = ''
    while (i < s.length && !',():'.includes(s[i]!)) label += s[i++]
    let length = 0
    if (s[i] === ':') {
      i++
      let num = ''
      while (i < s.length && !',()'.includes(s[i]!)) num += s[i++]
      length = Number(num) || 0
    }
    return { label, length, children }
  }
  return node()
}

/** A rectangular tree. Support labels stay as the source wrote them, such as 95.1/96. */
export function TreeFigure({ newick, labelFor, thresholds }: { newick: string; labelFor?: (tip: string) => string; thresholds?: number[] }) {
  const root = parseNewickForDisplay(newick)
  const tips: TreeNode[] = []
  let maxX = 0
  const pos = new Map<TreeNode, { x: number; y: number }>()
  const walk = (n: TreeNode, x: number): number => {
    maxX = Math.max(maxX, x)
    let y: number
    if (!n.children.length) { y = tips.length; tips.push(n) }
    else {
      const ys = n.children.map((c) => walk(c, x + c.length))
      y = (ys[0]! + ys[ys.length - 1]!) / 2
    }
    pos.set(n, { x, y })
    return y
  }
  walk(root, 0)
  const rowH = 18
  const treeW = 460
  const labelW = 300
  const px = (x: number) => 12 + (maxX ? x / maxX : 0) * treeW
  const py = (y: number) => 14 + y * rowH
  const lines: { key: string; d: string }[] = []
  const labels: { key: string; x: number; y: number; text: string; passes: boolean }[] = []
  const pass = (label: string) => {
    if (!thresholds?.length) return false
    const parts = label.split('/').map(Number)
    return parts.length === thresholds.length && parts.every((v, k) => v >= thresholds[k]!)
  }
  for (const [n, p] of pos) {
    for (const c of n.children) {
      const q = pos.get(c)!
      lines.push({ key: `${p.x}-${q.y}-${q.x}`, d: `M${px(p.x)} ${py(p.y)}V${py(q.y)}H${px(q.x)}` })
    }
    if (n.children.length && n.label) labels.push({ key: `s${p.x}${p.y}`, x: px(p.x) + 3, y: py(p.y) - 3, text: n.label, passes: pass(n.label) })
  }
  return (
    <svg className="ophy-tree" viewBox={`0 0 ${treeW + labelW + 24} ${tips.length * rowH + 24}`} role="img" aria-label={`Tree with ${tips.length} tips`}>
      {lines.map((l) => <path key={l.key} d={l.d} className="ophy-tree-edge" />)}
      {labels.map((l) => <text key={l.key} x={l.x} y={l.y} className={l.passes ? 'ophy-tree-support ophy-tree-supported' : 'ophy-tree-support'}>{l.text}</text>)}
      {tips.map((t) => { const p = pos.get(t)!; return <text key={t.label} x={px(p.x) + 6} y={py(p.y) + 4} className="ophy-tree-tip">{labelFor?.(t.label) ?? t.label}</text> })}
    </svg>
  )
}

export type LadderStep = { taxon: { name: string; rank: string }; records: number; species: string[]; sufficient: boolean }

export function OutgroupLadderView({ steps, suggested, caveat }: { steps: LadderStep[]; suggested?: string; caveat: string }) {
  return (
    <section>
      <ol className="ophy-ladder">
        {steps.map((s) => (
          <li key={s.taxon.name} className={s.taxon.name === suggested ? 'ophy-ladder-suggested' : ''}>
            <strong>{s.taxon.name}</strong> <span className="ophy-muted">({s.taxon.rank || 'no rank'})</span>: {s.records} records, {s.species.length} species{s.sufficient ? '' : '. Not enough, so looking further out'}
          </li>
        ))}
      </ol>
      <p className="ophy-muted">{caveat}</p>
    </section>
  )
}
export * from './network.js'
export * from './regionmap.js'
