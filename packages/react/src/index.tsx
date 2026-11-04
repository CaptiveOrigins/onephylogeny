import type { Finding, FindingStatus, Panel, Result, RunEvent, ValidationReport } from '@captiveorigins/onephylogeny-core'

export type Labels = Partial<Record<FindingStatus, string>>

const STATUS: Record<FindingStatus, { label: string; mark: string }> = {
  consistent: { label: 'Consistent', mark: '●' },
  excluded_within_panel: { label: 'Excluded within this panel', mark: '×' },
  not_evaluable: { label: 'Not evaluable', mark: '–' },
  inconclusive: { label: 'Inconclusive', mark: '?' },
  novel_or_unsampled_flag: { label: 'Possibly unsampled', mark: '!' },
}

export const statusLabel = (status: FindingStatus, labels?: Labels) => labels?.[status] ?? STATUS[status].label

/** A status always has words and a symbol, never color alone. */
export function StatusBadge({ status, labels }: { status: FindingStatus; labels?: Labels }) {
  return <span className={`ophy-status ophy-status-${status}`}><span aria-hidden="true">{STATUS[status].mark}</span> {statusLabel(status, labels)}</span>
}

const groupLabel = (panel: Panel, id: string) => panel.groups.find((g) => g.id === id)?.label ?? id
const ORDER: FindingStatus[] = ['consistent', 'novel_or_unsampled_flag', 'inconclusive', 'excluded_within_panel', 'not_evaluable']

/** The headline in plain words, including when the honest answer is that nothing can be said. */
export function summarizeResult(result: Result, panel: Panel): string {
  const named = (status: FindingStatus) => result.findings.filter((f) => f.status === status).map((f) => groupLabel(panel, f.group))
  const consistent = named('consistent')
  if (consistent.length === 1) return `Consistent with ${consistent[0]}`
  if (consistent.length) return `Can't separate: ${consistent.join(', ')}`
  const novel = named('novel_or_unsampled_flag')
  if (novel.length) return `No group fits. Closest is ${novel[0]}, which may mean an unsampled population`
  if (result.findings.every((f) => f.status === 'not_evaluable')) return 'Not enough shared sequence to evaluate any group'
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
  const rows = [...(queryAligned ? [{ id: '__q', label: queryLabel, windows: queryWindows }] : []), ...panel.groups.map((g) => ({ id: g.id, label: g.label, windows: g.windows }))]
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

/** Everything behind a conclusion: each group, its status, and why. */
export function ResultView({ result, panel, queryAligned, labels }: { result: Result; panel: Panel; queryAligned?: string; labels?: Labels }) {
  const findings = [...result.findings].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
  return (
    <section className="ophy-result">
      <h3>{summarizeResult(result, panel)}</h3>
      <p className="ophy-muted">Tested against {panel.id} version {panel.version}, over {result.overlap} sites.</p>
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
        <thead><tr><th>Group</th><th>Region</th><th>Records</th><th>Can show location</th><th>Sites fixed against other groups</th></tr></thead>
        <tbody>
          {panel.groups.map((g) => (
            <tr key={g.id}>
              <th scope="row">{g.label}</th>
              <td>{g.region ?? '–'}</td>
              <td>{g.evidence.length}</td>
              <td>{g.evidence.filter((e) => e.use === 'lineage-and-location').length}</td>
              <td>{g.windows.reduce((s, w) => s + w.diagnosticSites.length, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CoverageBars panel={panel} />
      {panel.notCovered.length > 0 && <p><strong>Not covered:</strong> {panel.notCovered.join(', ')}</p>}
      <p className="ophy-muted">Checksum {panel.checksum}</p>
    </section>
  )
}

const pct = (a: number, b: number) => (b ? `${a} of ${b}` : '–')

export function ValidationView({ blocks, groups }: { blocks: ValidationReport; groups: ValidationReport }) {
  const tested = new Set(blocks.groups.map((g) => g.group))
  const skippedGroups = groups.groups.map((g) => g.group).filter((g) => !tested.has(g))
  return (
    <section>
      <h4>Holding out each sampling site</h4>
      <table className="ophy-table">
        <thead><tr><th>Group</th><th>True group consistent</th><th>Only the true group</th><th>True group excluded</th><th>Not evaluable</th></tr></thead>
        <tbody>
          {blocks.groups.map((g) => <tr key={g.group}><th scope="row">{g.group}</th><td>{pct(g.includedTruth, g.tested)}</td><td>{pct(g.onlyTruth, g.tested)}</td><td>{pct(g.excludedTruth, g.tested)}</td><td>{pct(g.notEvaluable, g.tested)}</td></tr>)}
        </tbody>
      </table>
      {skippedGroups.length > 0 && <p className="ophy-warning">Not tested, because all their records come from one site: {skippedGroups.join(', ')}.</p>}
      <h4>Removing each whole group</h4>
      <p>{groups.falseConsistent ?? 0} of {groups.tested} records were wrongly called consistent with a remaining group. Lower is better, and this is how the panel behaves when a sample's true population is missing.</p>
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
