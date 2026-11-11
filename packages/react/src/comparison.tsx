import { useId, useState } from 'react'
import {
  CLAIM_CHANGE_TEXT, claimName, claimsText, claimStateText, gateChangeText, OUTCOME_COLUMNS, outcomeCells, outcomeTables, otherFieldsShown, recordsText, schemeText, settingsText, sideText, warningsText,
  type PanelComparison,
} from '@captiveorigins/onephylogeny-core'

/**
 * Two panel versions side by side: records that moved, settings that differ, claims that changed and each version's
 * validation outcomes with their intervals. The words come from core, so this and `comparisonMarkdown` say the same.
 * It never combines anything into a score and never says which version is better.
 */
export function ComparisonView({ comparison, initiallyShowSame = false }: { comparison: PanelComparison; initiallyShowSame?: boolean }) {
  const [showSame, setShowSame] = useState(initiallyShowSame)
  const toggle = useId()
  const { runs: r, labels } = comparison
  const group = (id: string) => labels.groups[id] ?? id
  const rec = r.records
  const same = r.claims.filter((c) => c.change === 'same').length
  const claims = r.claims.filter((c) => showSame || c.change !== 'same')
  const warnings = warningsText(comparison)
  const tables = outcomeTables(comparison.outcomes)
  return (
    <section className="ophy-comparison" aria-label={`Version ${r.a.version} compared with version ${r.b.version}`}>
      <p className="ophy-muted">What differs between the two versions. It doesn't say which is better: choosing the best-looking run after comparing isn't a test.</p>
      <ul>
        <li><strong>A</strong>: version {r.a.version}. {sideText(r.a)}</li>
        <li><strong>B</strong>: version {r.b.version}. {sideText(r.b)}</li>
      </ul>
      {warnings.map((w) => <p key={w} className="ophy-warning" role="note">{w}</p>)}
      <p>{settingsText(r)}</p>

      <h4>Records</h4>
      <p>{recordsText(rec)}</p>
      {rec.onlyA.length > 0 && <p>Only in A: {rec.onlyA.join(', ')}.</p>}
      {rec.onlyB.length > 0 && <p>Only in B: {rec.onlyB.join(', ')}.</p>}
      {rec.changedGroup.length > 0 && (
        <table className="ophy-table">
          <caption>Records that changed group</caption>
          <thead><tr><th scope="col">Record</th><th scope="col">Group in A</th><th scope="col">Group in B</th></tr></thead>
          <tbody>{rec.changedGroup.map((x) => <tr key={x.record}><th scope="row">{x.record}</th><td>{group(x.a)}</td><td>{group(x.b)}</td></tr>)}</tbody>
        </table>
      )}
      {rec.changedEvidence.map((f) => (
        <details key={f.field}>
          <summary>{f.records.length} {f.records.length === 1 ? 'record' : 'records'} changed {f.field}</summary>
          <table className="ophy-table">
            <caption>{f.field} in each version</caption>
            <thead><tr><th scope="col">Record</th><th scope="col">A</th><th scope="col">B</th></tr></thead>
            <tbody>{f.records.map((x) => <tr key={x.record}><th scope="row">{x.record}</th><td>{x.a ?? 'None'}</td><td>{x.b ?? 'None'}</td></tr>)}</tbody>
          </table>
        </details>
      ))}

      <h4>Claims</h4>
      <p>
        {claimsText(r)}{' '}
        {same > 0 && <label htmlFor={toggle}><input id={toggle} type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> Show unchanged claims</label>}
      </p>
      {claims.length > 0 && (
        <table className="ophy-table">
          <caption>{showSame ? 'Every claim' : 'Claims that changed'}, with each version's outcome</caption>
          <thead><tr><th scope="col">Claim</th><th scope="col">Change</th><th scope="col">A</th><th scope="col">B</th></tr></thead>
          <tbody>
            {claims.map((c) => {
              const others = otherFieldsShown(c)
              return (
                <tr key={`${c.a}|${c.b}|${c.window}`}>
                  <th scope="row">{claimName(c, labels)}</th>
                  <td>{CLAIM_CHANGE_TEXT[c.change]}</td>
                  <td>{claimStateText(c.before, c, labels)}</td>
                  <td>
                    {claimStateText(c.after, c, labels)}
                    {(c.gates.length > 0 || others.length > 0) && (
                      <ul className="ophy-muted">
                        {c.gates.map((g) => <li key={g.gate}>{gateChangeText(g)}</li>)}
                        {others.length > 0 && <li>Also differs in {others.join(', ')}.</li>}
                      </ul>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <h4>Validation outcomes</h4>
      {tables.length === 0 ? <p>Neither version has outcomes by window.</p> : <>
        <p className="ophy-muted">Each version's own counts, side by side. Each count is out of its tests, with an exact 95% interval; tests from one site or study aren't independent, so the true uncertainty is wider. Two intervals that overlap don't show the versions differ.</p>
        {tables.map((t) => {
          const differs = t.pairs.filter((p) => !p.same).map((p) => group(p.group))
          const title = `${labels.windows[t.window] ?? t.window}, ${schemeText(t.scheme)}`
          return (
            <table key={`${t.scheme}|${t.window}`} className="ophy-table">
              <caption>{title}. {differs.length ? `Differs for ${differs.join(', ')}.` : 'The same in both versions.'}</caption>
              <thead><tr><th scope="col">Group and version</th>{OUTCOME_COLUMNS.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {t.pairs.flatMap((p) => ([['a', r.a.version, p.a], ['b', r.b.version, p.b]] as const).map(([side, v, row]) => (
                  <tr key={`${p.group}|${side}`}>
                    <th scope="row">{group(p.group)}, version {v}</th>
                    {outcomeCells(row).map((x, i) => <td key={OUTCOME_COLUMNS[i]}>{x}</td>)}
                  </tr>
                )))}
              </tbody>
            </table>
          )
        })}
      </>}
      <p className="ophy-muted">These are counts on a reference panel, not calibrated probabilities, and there is no overall score.</p>
    </section>
  )
}
