import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { comparisonMarkdown, type PanelComparison, type Profile } from '@captiveorigins/onephylogeny-core'
import { panelVersionComparison, panelVersions, profilePaths } from '@captiveorigins/onephylogeny-engine'
import { ComparisonView } from '@captiveorigins/onephylogeny-react'
import type { Platform } from './platform'

const profileFolder = (profile: Profile) => profilePaths(profile.id).profile.replace(/\/profile\.json$/, '')

/** Where a saved comparison goes: beside the profile, named for both versions, so saving again replaces only that one. */
export const comparisonPath = (profile: Profile, a: string, b: string) => `${profileFolder(profile)}/comparisons/${profile.panel?.id ?? 'panel'}-${a}-vs-${b}.md`

/** Lists every built version and compares any two. It shows differences and never recommends one. */
export function CompareRuns({ profile, platform, attempt, busy }: { profile: Profile; platform: Platform; attempt: (l: string, w: () => Promise<void>) => Promise<void>; busy: boolean }) {
  const [versions, setVersions] = useState<string[]>([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [result, setResult] = useState<PanelComparison | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const picked = useRef(false)
  const heading = useId()
  const folder = `${profileFolder(profile)}/panels`

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

  const pick = (set: (v: string) => void) => (e: ChangeEvent<HTMLSelectElement>) => {
    picked.current = true
    set(e.target.value)
    // What's on screen always matches the two versions picked, so an older comparison is cleared.
    setResult(null)
    setSaved(null)
  }

  const compare = () => attempt('Comparing versions', async () => {
    setResult(null)
    setSaved(null)
    setResult(await panelVersionComparison(platform.store, profile, a, b))
  })

  const saveMarkdown = (c: PanelComparison) => attempt('Saving the comparison', async () => {
    const path = comparisonPath(profile, c.runs.a.version, c.runs.b.version)
    await platform.store.write(path, comparisonMarkdown(c))
    setSaved(path)
  })

  if (versions.length < 2) return <section className="pane"><h3>Compare versions</h3><p className="muted">{versions.length ? 'One version is built. Build another to compare them.' : 'No panel versions are built yet.'}</p></section>

  return (
    <section className="pane" aria-labelledby={heading}>
      <h3 id={heading}>Compare versions</h3>
      <p className="muted">{versions.length} versions built for this profile: {versions.join(', ')}. Every one stays listed. Picking the best-looking run after comparing isn't a test.</p>
      <div className="row">
        <label className="field"><span>Version A</span><select value={a} onChange={pick(setA)}>{versions.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="field"><span>Version B</span><select value={b} onChange={pick(setB)}>{versions.map((v) => <option key={v}>{v}</option>)}</select></label>
        <button onClick={compare} disabled={busy || !a || !b || a === b}>Compare</button>
        {a !== '' && a === b && <span className="muted">Pick two different versions.</span>}
      </div>
      {result && <div role="region" aria-label="Comparison">
        <ComparisonView comparison={result} />
        <div className="actions">
          <button onClick={() => saveMarkdown(result)} disabled={busy}>Save as Markdown</button>
          {saved && <><span role="status">Saved to {saved}. It reads as plain text, without the app.</span><button onClick={() => void platform.reveal(saved)}>Show file</button></>}
        </div>
      </div>}
    </section>
  )
}
