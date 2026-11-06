import { useEffect, useRef, useState } from 'react'
import type { ClaimComparison, Profile, RunComparison } from '@captiveorigins/onephylogeny-core'
import { comparePanelVersions, panelVersions, profilePaths } from '@captiveorigins/onephylogeny-engine'
import type { Platform } from './platform'

const CHANGE_LABEL: Record<ClaimComparison['change'], string> = {
  same: 'Same', gained: 'Now passes', lost: 'No longer passes', changed: 'Same outcome, different report', 'only-a': 'Only in A', 'only-b': 'Only in B', unknown: 'Not known',
}

const stateText = (s: ClaimComparison['before']) => (s ? `${s.passed ? 'Passed' : `Failed: ${s.failedGate ?? 'a gate'}`}. Sites ${s.sites.a} and ${s.sites.b}, records ${s.records.a} and ${s.records.b}` : 'No report')

/** Lists every built version and compares any two. It shows differences and never recommends one. */
export function CompareRuns({ profile, platform, attempt, busy }: { profile: Profile; platform: Platform; attempt: (l: string, w: () => Promise<void>) => Promise<void>; busy: boolean }) {
  const [versions, setVersions] = useState<string[]>([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [result, setResult] = useState<RunComparison | null>(null)
  const [showSame, setShowSame] = useState(false)
  const picked = useRef(false)
  const folder = `${profilePaths(profile.id).profile.replace(/\/profile\.json$/, '')}/panels`

  useEffect(() => {
    void platform.list(folder).catch(() => [] as string[]).then((names) => {
      const found = panelVersions(profile, names)
      setVersions(found)
      // The two newest, until someone picks. Their pick is kept while new versions arrive.
      if (!picked.current) {
        setA(found[found.length - 2] ?? '')
        setB(found[found.length - 1] ?? '')
      }
    })
    // `busy` is here so a build that finishes on this tab appears without leaving it.
  }, [platform, folder, profile, busy])

  const compare = () => attempt('Comparing versions', async () => {
    setResult(null)
    setResult(await comparePanelVersions(platform.store, profile, a, b))
  })

  if (versions.length < 2) return <section className="pane"><h3>Compare runs</h3><p className="muted">{versions.length ? 'One version is built. Build another to compare them.' : 'No panel versions are built yet.'}</p></section>

  const claims = result?.claims.filter((c) => showSame || c.change !== 'same') ?? []
  const records = result?.records
  return (
    <section className="pane">
      <h3>Compare runs</h3>
      <p className="muted">{versions.length} versions built for this profile: {versions.join(', ')}. Every one stays listed. Picking the best-looking run after comparing isn't a test.</p>
      <div className="row">
        <label className="field"><span>Version A</span><select value={a} onChange={(e) => { picked.current = true; setA(e.target.value) }}>{versions.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="field"><span>Version B</span><select value={b} onChange={(e) => { picked.current = true; setB(e.target.value) }}>{versions.map((v) => <option key={v}>{v}</option>)}</select></label>
        <button onClick={compare} disabled={!a || !b || a === b}>Compare</button>
      </div>
      {result && records && <div role="region" aria-label="Comparison">
        {[result.a, result.b].map((s, i) => <p key={s.version} className="muted">{i ? 'B' : 'A'}: version {s.version}. {s.study ? `From Study ${s.study.title}${s.study.postHocOmitted.length ? `, with ${s.study.postHocOmitted.length} post hoc omissions` : ''}.` : 'Not from a Study.'}</p>)}
        {result.postHoc.map((p) => <p key={p.side} className="badge warn">Version {p.side === 'a' ? result.a.version : result.b.version} left out {p.omitted.length} records after results were seen. The other version has {p.inOtherSide.length} of them.</p>)}
        {result.notes.map((n) => <p key={n} className="muted">{n}</p>)}
        <p>{result.settings.length ? <>Settings differ, so changes may not come from the records: {result.settings.join(', ')}.</> : 'Settings are the same.'} {result.sameSequences ? 'The sequences are identical.' : 'The sequences differ.'}</p>

        <h4>Records</h4>
        <p>{records.shared} shared, {records.onlyA.length} only in A, {records.onlyB.length} only in B, {records.changedGroup.length} changed group.</p>
        {records.onlyA.length > 0 && <p className="muted">Only in A: {records.onlyA.join(', ')}</p>}
        {records.onlyB.length > 0 && <p className="muted">Only in B: {records.onlyB.join(', ')}</p>}
        {records.changedGroup.length > 0 && <table><thead><tr><th scope="col">Record</th><th scope="col">Group in A</th><th scope="col">Group in B</th></tr></thead><tbody>{records.changedGroup.map((r) => <tr key={r.record}><th scope="row">{r.record}</th><td>{r.a}</td><td>{r.b}</td></tr>)}</tbody></table>}
        {records.changedEvidence.map((f) => <details key={f.field}><summary>{f.records.length} records changed {f.field}</summary><table><thead><tr><th scope="col">Record</th><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody>{f.records.map((r) => <tr key={r.record}><th scope="row">{r.record}</th><td>{r.a ?? 'None'}</td><td>{r.b ?? 'None'}</td></tr>)}</tbody></table></details>)}

        <h4>Claims</h4>
        <p>{result.claims.filter((c) => c.change === 'same').length} of {result.claims.length} are the same. <label className="check"><input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> Show unchanged claims</label></p>
        {claims.length > 0 && <table><thead><tr><th scope="col">Claim</th><th scope="col">Change</th><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody>{claims.map((c) => <tr key={`${c.a}|${c.b}|${c.window}`}><th scope="row">{c.a} vs {c.b}, {c.window}</th><td>{CHANGE_LABEL[c.change]}</td><td>{stateText(c.before)}</td><td>{stateText(c.after)}{c.gates.map((g) => <div key={g.gate} className="muted">{g.gate}: {g.before ?? 'not run'} → {g.after ?? 'not run'}</div>)}{c.otherFields.length > 0 && <div className="muted">Also differs: {c.otherFields.join(', ')}</div>}</td></tr>)}</tbody></table>}
      </div>}
    </section>
  )
}
