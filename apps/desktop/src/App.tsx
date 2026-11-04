import { NcbiClient, suggestOutgroups, type OutgroupLadder } from '@captiveorigins/onephylogeny-acquire'
import { parseFasta, validateProfile, type Curation, type Diagnostic, type EvidenceUse, type Panel, type Profile, type ProvenanceClass, type Result, type RunEvent, type SequenceRecord, type Snapshot } from '@captiveorigins/onephylogeny-core'
import { buildPanelFromRun, buildTree, fetchAndAnchor, loadPanel, profilePaths, testSample, type EngineContext, type RecordOutcome, type TreeOutcome } from '@captiveorigins/onephylogeny-engine'
import { EventLog, OutgroupLadderView, PanelSummary, ResultView, TreeFigure, ValidationView } from '@captiveorigins/onephylogeny-react'
import { treeToPhylogeny } from '@captiveorigins/onephylogeny-onetaxonomy'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Platform } from './platform'
import { PREVIEW_SAMPLE } from './platform-preview'

const PROVENANCE: { value: ProvenanceClass; label: string }[] = [
  { value: 'unknown', label: 'Unknown' }, { value: 'wild-documented', label: 'Wild, documented' }, { value: 'museum-documented', label: 'Museum, documented' },
  { value: 'seized', label: 'Seized' }, { value: 'ex-situ', label: 'Ex-situ' }, { value: 'zoo', label: 'Zoo' },
]
const LOCATION: ProvenanceClass[] = ['wild-documented', 'museum-documented']
type Tab = 'setup' | 'records' | 'panel' | 'sample' | 'tree' | 'log'
const TABS: { id: Tab; label: string }[] = [{ id: 'setup', label: 'Setup' }, { id: 'records', label: 'Records' }, { id: 'panel', label: 'Panel' }, { id: 'sample', label: 'Test a sample' }, { id: 'tree', label: 'Tree' }, { id: 'log', label: 'Log' }]
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
const emptyCuration: Curation = { schemaVersion: 1, records: {} }
const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)

function newProfile(title: string, id: string): Profile {
  return {
    schemaVersion: 1, id, title,
    selection: { id, title, taxa: [], marker: { kind: 'gene', gene: '', synonyms: [], products: [] }, outgroups: [], exclude: [], filters: { minLength: 300, maxAmbiguous: 10 } },
    reference: { accession: '' },
    tree: { model: 'MFP', bootstrap: 1000, shAlrt: 1000, seed: 1, threads: 1 },
    panel: { id: `${id}-panel`, version: '0.1.0', groups: [], notCovered: [], validatedScope: [], thresholds: { minOverlap: 100, tolerance: 1, minDiagnosticConflicts: 2 } },
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}
function Diagnostics({ items }: { items: Diagnostic[] }) {
  if (!items.length) return null
  return <ul className="diagnostics">{items.map((d, i) => <li key={i} className={`diag-${d.severity}`}><strong>{d.severity === 'error' ? 'Problem' : d.severity === 'warning' ? 'Warning' : 'Note'}:</strong> {d.message}</li>)}</ul>
}

export function App({ platform }: { platform: Platform }) {
  const [root, setRoot] = useState(platform.root())
  const [profiles, setProfiles] = useState<string[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [curation, setCuration] = useState<Curation>(emptyCuration)
  const [tab, setTab] = useState<Tab>('setup')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(true)
  const [records, setRecords] = useState<SequenceRecord[]>([])
  const [outcomes, setOutcomes] = useState<RecordOutcome[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [panelState, setPanelState] = useState<{ panel: Panel; diagnostics: Diagnostic[]; validation: any; unassigned: number } | null>(null)

  const P = profile ? profilePaths(profile.id) : null
  const refresh = useCallback(async () => { if (platform.root()) setProfiles(await platform.list('profiles')) }, [platform])
  useEffect(() => { void refresh() }, [refresh, root])

  const engine = (): EngineContext => ({ store: platform.store, ncbi: { fetch: platform.fetch, tool: 'onephylogeny-mac' }, ...(platform.tools ? { tools: platform.tools } : {}), onEvent: (e) => setEvents((x) => [...x, e]) })
  const attempt = async (label: string, work: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  const loadRun = async (p: Profile) => {
    const paths = profilePaths(p.id)
    setRecords([]); setOutcomes([]); setRunId(null); setPanelState(null); setEvents([])
    if (await platform.store.exists(paths.latest)) {
      const id = (await platform.store.read(paths.latest)).trim()
      const dir = paths.run(id)
      setRunId(id)
      if (await platform.store.exists(`${dir}/snapshot.json`)) {
        setRecords((JSON.parse(await platform.store.read(`${dir}/snapshot.json`)) as Snapshot).records)
        setOutcomes(JSON.parse(await platform.store.read(`${dir}/outcomes.json`)))
      }
      if (await platform.store.exists(`${dir}/events.jsonl`)) setEvents((await platform.store.read(`${dir}/events.jsonl`)).split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    }
    if (p.panel) {
      const dir = paths.panel(p.panel.id, p.panel.version)
      if (await platform.store.exists(`${dir}/panel.json`)) {
        const extra = JSON.parse(await platform.store.read(`${dir}/diagnostics.json`))
        setPanelState({ panel: (await loadPanel(platform.store, dir)).panel, diagnostics: extra.diagnostics, unassigned: extra.unassigned, validation: JSON.parse(await platform.store.read(`${dir}/validation.json`)) })
      }
    }
  }
  const open = (id: string) => attempt('Opening', async () => {
    const paths = profilePaths(id)
    const p = JSON.parse(await platform.store.read(paths.profile)) as Profile
    setProfile(p)
    setCuration((await platform.store.exists(paths.curation)) ? JSON.parse(await platform.store.read(paths.curation)) : emptyCuration)
    setSaved(true)
    setTab('setup')
    await loadRun(p)
  })
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const create = (title: string) => attempt('Creating', async () => {
    setCreating(false)
    setNewTitle('')
    let id = slug(title)
    const existing = await platform.list('profiles')
    for (let n = 2; existing.includes(id); n++) id = `${slug(title)}-${n}`
    const p = newProfile(title, id)
    await platform.store.write(profilePaths(id).profile, `${JSON.stringify(p, null, 2)}\n`)
    await refresh()
    setProfile(p); setCuration(emptyCuration); setSaved(true); setTab('setup')
    await loadRun(p)
  })
  const edit = (p: Profile) => { setProfile(p); setSaved(false) }
  const save = async (p = profile) => { if (p) { await platform.store.write(profilePaths(p.id).profile, `${JSON.stringify(p, null, 2)}\n`); setSaved(true) } }
  const decide = async (next: Curation) => { setCuration(next); if (P) await platform.store.write(P.curation, `${JSON.stringify(next, null, 2)}\n`) }

  const header = (
    <aside className="side">
      <h1>OnePhylogeny</h1>
      {creating
        ? <form className="new-profile" onSubmit={(e) => { e.preventDefault(); if (newTitle.trim()) void create(newTitle.trim()) }}><Field label="Profile name"><input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Species and marker" /></Field><div className="actions"><button type="submit" className="primary" disabled={!newTitle.trim()}>Create</button><button type="button" onClick={() => setCreating(false)}>Cancel</button></div></form>
        : <button onClick={() => setCreating(true)} disabled={!root}>New profile</button>}
      <nav aria-label="Profiles">{profiles.map((id) => <button key={id} className={profile?.id === id ? 'selected' : ''} onClick={() => open(id)}>{id}</button>)}</nav>
      {!profiles.length && root && <p className="muted">Each profile is one species and marker, with its own records and panels.</p>}
      <div className="side-foot">
        <small title={root ?? ''}>{root ?? 'No workspace chosen'}</small>
        {platform.kind === 'mac' && <button onClick={async () => { const r = await platform.chooseWorkspace(); if (r) { setRoot(r); setProfile(null) } }}>{root ? 'Change workspace' : 'Choose workspace'}</button>}
        {platform.kind === 'preview' && <p className="muted">Browser preview with made-up data. Nothing is saved.</p>}
      </div>
    </aside>
  )
  if (!profile) return <div className="app">{header}<main className="empty"><h2>{root ? 'Open or create a profile' : 'Choose a workspace folder to begin'}</h2><p className="muted">A profile says what to fetch, how to check it and how to build a panel. Everything lives in plain files in your workspace.</p>{error && <p role="alert" className="error">{error}</p>}</main></div>

  return (
    <div className="app">
      {header}
      <main>
        <header className="top">
          <h2>{profile.title}</h2>
          <div role="tablist" className="tabs">{TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'selected' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
          {busy && <span role="status" className="busy">{busy}…</span>}
        </header>
        {error && <p role="alert" className="error">{error}</p>}
        {tab === 'setup' && <Setup profile={profile} edit={edit} save={save} saved={saved} platform={platform} attempt={attempt} client={() => new NcbiClient(engine().ncbi)} />}
        {tab === 'records' && <Records profile={profile} curation={curation} decide={decide} records={records} outcomes={outcomes} runId={runId} platform={platform} busy={Boolean(busy)} onFetch={() => attempt('Fetching records', async () => {
          await save()
          setEvents([])
          const out = await fetchAndAnchor(engine(), profile)
          setRecords(out.records); setOutcomes(out.outcomes); setRunId(out.run.id)
        })} />}
        {tab === 'panel' && <PanelTab profile={profile} edit={edit} save={save} state={panelState} hasRun={Boolean(runId)} busy={Boolean(busy)} platform={platform} onBuild={() => attempt('Building panel', async () => {
          await save()
          const out = await buildPanelFromRun(engine(), profile, curation)
          setPanelState({ panel: out.bundle.panel, diagnostics: out.diagnostics, validation: out.validation, unassigned: out.unassigned })
        })} />}
        {tab === 'sample' && <SampleTab profile={profile} platform={platform} hasPanel={Boolean(panelState)} attempt={attempt} />}
        {tab === 'tree' && <TreeTab profile={profile} edit={edit} platform={platform} records={records} attempt={attempt} run={(w) => buildTree(engine(), profile, { absoluteDir: platform.root()!, ...(w ? { window: w } : {}) })} hasRun={Boolean(runId)} />}
        {tab === 'log' && <section className="pane"><p className="muted">{runId ? `Run ${runId}` : 'No run yet'}</p><EventLog events={events} />{runId && P && <button onClick={() => platform.reveal(`${P.run(runId)}/run.json`)}>Show run files</button>}</section>}
      </main>
    </div>
  )
}

function Setup({ profile, edit, save, saved, platform, attempt, client }: { profile: Profile; edit: (p: Profile) => void; save: () => Promise<void>; saved: boolean; platform: Platform; attempt: (l: string, w: () => Promise<void>) => Promise<void>; client: () => NcbiClient }) {
  const s = profile.selection
  const m = s.marker
  const setS = (x: Partial<typeof s>) => edit({ ...profile, selection: { ...s, ...x } })
  const setM = (x: Partial<typeof m>) => setS({ marker: { ...m, ...x } })
  const [name, setName] = useState('')
  const [found, setFound] = useState<{ id: string; scientificName: string }[] | null>(null)
  const [ladder, setLadder] = useState<OutgroupLadder | null>(null)
  const problems = validateProfile(profile)
  const ref = profile.reference ?? { accession: '' }
  return (
    <section className="pane form">
      <h3>Species</h3>
      <div className="row">
        <Field label="Search by scientific name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Genus species" /></Field>
        <button disabled={!name} onClick={() => attempt('Searching taxonomy', async () => setFound(await client().findTaxon(name)))}>Find</button>
      </div>
      {found && (found.length ? found.map((t) => <button key={t.id} onClick={() => { setS({ taxa: [...s.taxa.filter((x) => x.id !== t.id), { source: 'ncbi-taxonomy', id: t.id }] }); setFound(null) }}>Add {t.scientificName} (taxon {t.id})</button>) : <p className="muted">No taxon has that exact name.</p>)}
      <ul className="chips">{s.taxa.map((t) => <li key={t.id}>{t.source}:{t.id} <button aria-label={`Remove ${t.id}`} onClick={() => setS({ taxa: s.taxa.filter((x) => x !== t) })}>×</button></li>)}</ul>
      <h3>Marker</h3>
      <div className="grid">
        <Field label="Kind"><select value={m.kind} onChange={(e) => setM({ kind: e.target.value as typeof m.kind })}><option value="gene">One gene</option><option value="mitogenome">Mitochondrial genome</option><option value="snp">SNPs (import only, coming later)</option></select></Field>
        {m.kind === 'gene' && <>
          <Field label="Gene symbol"><input value={m.gene ?? ''} onChange={(e) => setM({ gene: e.target.value })} /></Field>
          <Field label="Other symbols" hint="Comma separated"><input defaultValue={(m.synonyms ?? []).join(', ')} onBlur={(e) => setM({ synonyms: lines(e.target.value) })} /></Field>
          <Field label="Protein names" hint="Exact product names, comma separated"><input defaultValue={(m.products ?? []).join(', ')} onBlur={(e) => setM({ products: lines(e.target.value) })} /></Field>
          <Field label="Organelle"><select value={m.organelle ?? ''} onChange={(e) => { const { organelle: _o, ...rest } = m; setS({ marker: e.target.value ? { ...rest, organelle: e.target.value as 'mitochondrion' } : rest }) }}><option value="">Any</option><option value="mitochondrion">Mitochondrion</option><option value="plastid">Plastid</option></select></Field>
        </>}
      </div>
      <h3>Reference</h3>
      <div className="grid">
        <Field label="Reference accession" hint="With version. Every record is anchored to this"><input value={ref.accession} onChange={(e) => edit({ ...profile, reference: { ...ref, accession: e.target.value.trim() } })} /></Field>
        <Field label="Genetic code" hint="Used to check reading frame"><select value={ref.geneticCode ?? ''} onChange={(e) => { const { geneticCode: _g, codonStart: _c, ...rest } = ref; edit({ ...profile, reference: e.target.value ? { ...rest, geneticCode: Number(e.target.value) as 1 | 2, codonStart: ref.codonStart ?? 0 } : rest }) }}><option value="">Don't check</option><option value="2">Vertebrate mitochondrial (2)</option><option value="1">Standard (1)</option></select></Field>
      </div>
      <h3>Filters</h3>
      <div className="grid">
        {(['minLength', 'maxLength', 'maxAmbiguous'] as const).map((k) => <Field key={k} label={{ minLength: 'Minimum length', maxLength: 'Maximum length', maxAmbiguous: 'Most ambiguous bases' }[k]}><input type="number" min={0} value={s.filters[k] ?? ''} onChange={(e) => { const { [k]: _omit, ...rest } = s.filters; setS({ filters: e.target.value === '' ? rest : { ...rest, [k]: Number(e.target.value) } }) }} /></Field>)}
      </div>
      <h3>Outgroups</h3>
      <button disabled={!s.taxa.length || m.kind === 'snp'} onClick={() => attempt('Looking outward for outgroups', async () => setLadder(await suggestOutgroups(client(), s)))}>Suggest outgroups</button>
      {ladder && <>
        <OutgroupLadderView steps={ladder.steps} {...(ladder.suggested ? { suggested: ladder.suggested.taxon.name } : {})} caveat={ladder.caveat} />
        {ladder.suggested ? <ul className="plain">{ladder.suggested.candidates.slice(0, 20).map((c) => <li key={c.accession}><button disabled={s.outgroups.some((o) => o.accession === c.accession)} onClick={() => setS({ outgroups: [...s.outgroups, { accession: c.accession, rationale: `Suggested from ${ladder.suggested!.taxon.name}` }] })}>Add</button> {c.organism} <span className="muted">{c.accession}, {c.length} bp</span></li>)}</ul> : <p className="muted">No level had enough species with this marker.</p>}
      </>}
      <ul className="chips">{s.outgroups.map((o, i) => <li key={i}>{o.accession} <button aria-label={`Remove ${o.accession}`} onClick={() => setS({ outgroups: s.outgroups.filter((x) => x !== o) })}>×</button></li>)}</ul>
      <Field label="Add an outgroup accession"><input placeholder="Press Enter to add" onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value.trim()) { setS({ outgroups: [...s.outgroups, { accession: e.currentTarget.value.trim(), rationale: 'Added by hand' }] }); e.currentTarget.value = '' } }} /></Field>
      <h3>Excluded records</h3>
      <ul className="plain">{s.exclude.map((x) => <li key={x.accession}>{x.accession}: {x.reason} <button onClick={() => setS({ exclude: s.exclude.filter((y) => y !== x) })}>Remove</button></li>)}</ul>
      <p className="muted">Exclude a record from the Records tab, where you can give a reason.</p>
      <Diagnostics items={problems} />
      <div className="actions"><button className="primary" disabled={saved} onClick={() => save()}>{saved ? 'Saved' : 'Save profile'}</button><span className="muted">{platform.kind === 'preview' ? 'Preview only' : 'Stored as plain JSON in your workspace'}</span></div>
    </section>
  )
}

function Records({ profile, curation, decide, records, outcomes, runId, platform, busy, onFetch }: { profile: Profile; curation: Curation; decide: (c: Curation) => Promise<void>; records: SequenceRecord[]; outcomes: RecordOutcome[]; runId: string | null; platform: Platform; busy: boolean; onFetch: () => void }) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'excluded' | 'undecided'>('all')
  const [study, setStudy] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<{ id: string; reason: string } | null>(null)
  const groups = profile.panel?.groups ?? []
  const outcome = useMemo(() => new Map(outcomes.map((o) => [o.record, o])), [outcomes])
  const titleOf = (r: SequenceRecord) => r.publications[0]?.title ?? 'No publication'
  const studies = useMemo(() => {
    const m = new Map<string, SequenceRecord[]>()
    for (const r of records) { const t = titleOf(r); m.set(t, [...(m.get(t) ?? []), r]) }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [records])
  const provOf = (r: SequenceRecord) => curation.records[r.version]?.provenanceClass ?? r.provenanceClass
  const set = (ids: string[], change: Partial<Curation['records'][string]>) => {
    const next = { ...curation.records }
    for (const id of ids) next[id] = { ...next[id], ...change }
    return decide({ ...curation, records: next })
  }
  const shown = records.filter((r) => {
    const o = outcome.get(r.version)
    if (study && titleOf(r) !== study) return false
    if (filter === 'passed') return o?.status === 'passed'
    if (filter === 'excluded') return o?.status === 'excluded' || curation.records[r.version]?.exclude
    if (filter === 'undecided') return o?.status === 'passed' && !curation.records[r.version]?.group && !curation.records[r.version]?.exclude
    return true
  })
  const P = profilePaths(profile.id)
  const passed = outcomes.filter((o) => o.status === 'passed').length
  const assigned = records.filter((r) => curation.records[r.version]?.group).length
  return (
    <section className="pane">
      <div className="actions">
        <button className="primary" disabled={busy} onClick={onFetch}>{records.length ? 'Fetch again' : 'Fetch records'}</button>
        {runId && <button onClick={() => platform.reveal(`${P.run(runId)}/records.csv`)}>Show spreadsheet</button>}
        {records.length > 0 && <span className="muted">{records.length} records, {passed} passed checks, {assigned} in groups</span>}
      </div>
      {!records.length && <p className="muted">This searches NCBI for your species and marker, keeps the raw files, checks each record against the reference and writes the spreadsheet. Interrupted runs resume from what was already downloaded.</p>}
      {records.length > 0 && <>
        <h3>Review by study</h3>
        <p className="muted">Give records a site so validation can hold out whole sites. Without one, a record can be tested against others from its own site, which flatters the result.</p>
        <p className="muted">Sources rarely say whether an animal was wild or seized, so check the paper, then set the whole study at once. Only wild or museum records with documented origins count as evidence of location.</p>
        <table className="ophy-table"><thead><tr><th>Study</th><th>Records</th><th>Set provenance for all</th></tr></thead><tbody>
          {studies.map(([title, rs]) => <tr key={title}><th scope="row"><button className="link" onClick={() => setStudy(study === title ? null : title)}>{title}</button></th><td>{rs.length}</td><td><select aria-label={`Provenance for ${title}`} value="" onChange={(e) => e.target.value && set(rs.map((r) => r.version), { provenanceClass: e.target.value as ProvenanceClass })}><option value="">Choose…</option>{PROVENANCE.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></td></tr>)}
        </tbody></table>
        <h3>Records{study ? `: ${study}` : ''}</h3>
        <div className="actions"><Field label="Show"><select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">All</option><option value="undecided">Passed, not in a group</option><option value="passed">Passed checks</option><option value="excluded">Excluded</option></select></Field>{study && <button onClick={() => setStudy(null)}>Show all studies</button>}<span className="muted">{shown.length} shown</span></div>
        <div className="scroll"><table className="ophy-table records"><thead><tr><th>Accession</th><th>Organism</th><th>GenBank location</th><th>Checks</th><th>Provenance</th><th>Group</th><th>Site</th><th>Use in panel</th></tr></thead><tbody>
          {shown.slice(0, 500).map((r) => {
            const o = outcome.get(r.version)
            const d = curation.records[r.version] ?? {}
            const prov = provOf(r)
            return <tr key={r.version} className={o?.status === 'excluded' || d.exclude ? 'dim' : ''}>
              <th scope="row">{r.version}</th><td>{r.organism}</td><td>{r.geoLocName ?? '–'}</td>
              <td>{o?.status === 'excluded' ? <span title={o.diagnostics.map((x) => x.message).join('\n')}>Excluded: {o.diagnostics.find((x) => x.severity === 'error')?.code}</span> : o?.diagnostics.length ? <span title={o.diagnostics.map((x) => x.message).join('\n')}>Passed, {o.diagnostics.length} note</span> : 'Passed'}</td>
              <td><select aria-label={`Provenance of ${r.version}`} value={prov} onChange={(e) => set([r.version], { provenanceClass: e.target.value as ProvenanceClass })}>{PROVENANCE.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></td>
              <td><select aria-label={`Group of ${r.version}`} disabled={o?.status === 'excluded'} value={d.group ?? ''} onChange={(e) => { const { group: _g, ...rest } = d; void decide({ ...curation, records: { ...curation.records, [r.version]: e.target.value ? { ...rest, group: e.target.value } : rest } }) }}><option value="">None</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></td>
              <td><input aria-label={`Site of ${r.version}`} defaultValue={d.site ?? ''} onBlur={(e) => e.target.value !== (d.site ?? '') && set([r.version], { site: e.target.value })} placeholder="Site" /></td>
              <td className="use">
                <div className="muted">{LOCATION.includes(prov) ? 'Lineage and location' : 'Lineage only'}</div>
                {d.exclude
                  ? <><div className="muted" title={d.note}>Left out: {d.note}</div><button onClick={() => { const { exclude: _e, note: _n, ...rest } = d; void decide({ ...curation, records: { ...curation.records, [r.version]: rest } }) }}>Include</button></>
                  : leaving?.id === r.version
                    ? <form className="leave" onSubmit={(e) => { e.preventDefault(); if (leaving.reason.trim()) { void set([r.version], { exclude: true, note: leaving.reason.trim() }); setLeaving(null) } }}><input autoFocus aria-label={`Reason for leaving out ${r.version}`} placeholder="Reason" value={leaving.reason} onChange={(e) => setLeaving({ id: r.version, reason: e.target.value })} /><button type="submit" disabled={!leaving.reason.trim()}>Leave out</button><button type="button" onClick={() => setLeaving(null)}>Cancel</button></form>
                    : <button disabled={o?.status === 'excluded'} onClick={() => setLeaving({ id: r.version, reason: '' })}>Leave out</button>}
              </td>
            </tr>
          })}
        </tbody></table></div>
        {shown.length > 500 && <p className="muted">Showing the first 500. Filter by study to see the rest.</p>}
      </>}
    </section>
  )
}

function PanelTab({ profile, edit, save, state, hasRun, busy, platform, onBuild }: { profile: Profile; edit: (p: Profile) => void; save: () => Promise<void>; state: { panel: Panel; diagnostics: Diagnostic[]; validation: any; unassigned: number } | null; hasRun: boolean; busy: boolean; platform: Platform; onBuild: () => void }) {
  const panel = profile.panel!
  const setP = (x: Partial<typeof panel>) => edit({ ...profile, panel: { ...panel, ...x } })
  const th = panel.thresholds
  const P = profilePaths(profile.id)
  const [newGroup, setNewGroup] = useState('')
  return (
    <section className="pane form">
      <h3>Groups</h3>
      <p className="muted">Groups are your working hypothesis. Assign records to them in the Records tab, and the validation below tests them.</p>
      <table className="ophy-table"><thead><tr><th>Name</th><th>Region</th><th /></tr></thead><tbody>
        {panel.groups.map((g, i) => <tr key={g.id}><td><input aria-label="Group name" value={g.label} onChange={(e) => setP({ groups: panel.groups.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)) })} /></td><td><input aria-label="Region" placeholder="A general region, never coordinates" value={g.region ?? ''} onChange={(e) => setP({ groups: panel.groups.map((x, n) => (n === i ? { ...x, region: e.target.value } : x)) })} /></td><td><button onClick={() => setP({ groups: panel.groups.filter((x) => x !== g) })}>Remove</button></td></tr>)}
      </tbody></table>
      <div className="row"><Field label="New group"><input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} /></Field><button disabled={!newGroup.trim() || panel.groups.some((g) => g.id === slug(newGroup))} onClick={() => { setP({ groups: [...panel.groups, { id: slug(newGroup), label: newGroup.trim() }] }); setNewGroup('') }}>Add group</button></div>
      <h3>Panel settings</h3>
      <div className="grid">
        <Field label="Panel id"><input value={panel.id} onChange={(e) => setP({ id: slug(e.target.value) })} /></Field>
        <Field label="Version" hint="A new version never overwrites results"><input value={panel.version} onChange={(e) => setP({ version: e.target.value.trim() })} /></Field>
        <Field label="Minimum shared sites" hint="Below this, a group is not evaluable"><input type="number" min={1} value={th.minOverlap} onChange={(e) => setP({ thresholds: { ...th, minOverlap: Number(e.target.value) } })} /></Field>
        <Field label="Extra differences allowed"><input type="number" min={0} value={th.tolerance} onChange={(e) => setP({ thresholds: { ...th, tolerance: Number(e.target.value) } })} /></Field>
        <Field label="Fixed-site conflicts to exclude"><input type="number" min={1} value={th.minDiagnosticConflicts} onChange={(e) => setP({ thresholds: { ...th, minDiagnosticConflicts: Number(e.target.value) } })} /></Field>
      </div>
      <Field label="What this panel doesn't cover" hint="Regions or populations with no samples, comma separated. Every report shows this"><input defaultValue={panel.notCovered.join(', ')} onBlur={(e) => setP({ notCovered: lines(e.target.value) })} /></Field>
      <div className="actions"><button className="primary" disabled={busy || !hasRun || !panel.groups.length} onClick={onBuild}>Build and validate panel</button>{!hasRun && <span className="muted">Fetch records first.</span>}{state && <button onClick={() => platform.reveal(`${P.panel(state.panel.id, state.panel.version)}/panel.json`)}>Show exported files</button>}</div>
      {state && <>
        <h3>{state.panel.id} version {state.panel.version}</h3>
        <Diagnostics items={state.diagnostics} />
        {state.unassigned > 0 && <p className="muted">{state.unassigned} records passed checks but aren't in a group, so they aren't in this panel.</p>}
        <PanelSummary panel={state.panel} />
        <h3>Validation</h3>
        <ValidationView blocks={state.validation.blocks} groups={state.validation.groups} />
      </>}
    </section>
  )
}

function SampleTab({ profile, platform, hasPanel, attempt }: { profile: Profile; platform: Platform; hasPanel: boolean; attempt: (l: string, w: () => Promise<void>) => Promise<void> }) {
  const [text, setText] = useState(platform.kind === 'preview' ? PREVIEW_SAMPLE : '')
  const [out, setOut] = useState<{ id: string; panel: Panel; result: Result | null; diagnostics: Diagnostic[]; aligned?: string }[]>([])
  const P = profilePaths(profile.id)
  const run = () => attempt('Testing', async () => {
    const entries = parseFasta(text)
    if (!entries.length) throw new Error('Paste a FASTA sequence, starting with a line such as >my-sample')
    const bundle = await loadPanel(platform.store, P.panel(profile.panel!.id, profile.panel!.version))
    const results = entries.map((e) => {
      const r = testSample(e.sequence, e.id, bundle, profile.panel!.thresholds)
      return { id: e.id, panel: bundle.panel, result: r.result, diagnostics: r.diagnostics, ...(r.result ? { aligned: r.aligned } : {}) }
    })
    setOut(results)
    for (const r of results) if (r.result) await platform.store.write(`${P.results}/${bundle.panel.id}-${bundle.panel.version}/${r.id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`, `${JSON.stringify(r.result, null, 2)}\n`)
  })
  return (
    <section className="pane form">
      <Field label="Sequences in FASTA format"><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'>sample-name\nACGT…'} spellCheck={false} /></Field>
      <div className="actions">
        <button onClick={() => attempt('Opening', async () => { const f = await platform.openTextFile(); if (f) setText(f.text) })}>Open a file</button>
        <button className="primary" disabled={!hasPanel || !text.trim()} onClick={run}>Test against panel</button>
        {!hasPanel && <span className="muted">Build a panel first.</span>}
      </div>
      {out.map((r) => <article key={r.id} className="sample"><h3>{r.id}</h3>{r.result ? <ResultView result={r.result} panel={r.panel} {...(r.aligned ? { queryAligned: r.aligned } : {})} /> : <p className="error">This sample couldn't be compared with the panel.</p>}<Diagnostics items={r.diagnostics.filter((d) => d.severity !== 'info')} /></article>)}
    </section>
  )
}

function TreeTab({ profile, edit, platform, records, attempt, run, hasRun }: { profile: Profile; edit: (p: Profile) => void; platform: Platform; records: SequenceRecord[]; attempt: (l: string, w: () => Promise<void>) => Promise<void>; run: (w?: { start: number; end: number }) => Promise<TreeOutcome>; hasRun: boolean }) {
  const [version, setVersion] = useState<string | null | undefined>(undefined)
  const [tree, setTree] = useState<TreeOutcome | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  useEffect(() => { void (platform.tools ? platform.tools.version('iqtree3').then(setVersion) : Promise.resolve(setVersion(null))) }, [platform])
  const t = profile.tree!
  const org = useMemo(() => new Map(records.map((r) => [r.version, r.organism ?? ''])), [records])
  const labelFor = (tip: string) => {
    const members = tree?.tips.find((x) => x.id === tip)?.members ?? []
    return members.length ? `${members[0]} ${org.get(members[0]!) ?? ''}${members.length > 1 ? ` +${members.length - 1}` : ''}` : tip
  }
  return (
    <section className="pane form">
      <p className="muted">A tree shows relationships as evidence for the panel. Testing a sample doesn't need one. {version ? `Using ${version}.` : ''}</p>
      {version === null && <p className="error">IQ-TREE 3 wasn't found. Install it with <code>brew install iqtree3</code>, then reopen this tab.</p>}
      <div className="grid">
        <Field label="Model"><input value={t.model} onChange={(e) => edit({ ...profile, tree: { ...t, model: e.target.value } })} /></Field>
        <Field label="Ultrafast bootstrap"><input type="number" value={t.bootstrap} onChange={(e) => edit({ ...profile, tree: { ...t, bootstrap: Number(e.target.value) } })} /></Field>
        <Field label="SH-aLRT"><input type="number" value={t.shAlrt} onChange={(e) => edit({ ...profile, tree: { ...t, shAlrt: Number(e.target.value) } })} /></Field>
        <Field label="Seed"><input type="number" value={t.seed} onChange={(e) => edit({ ...profile, tree: { ...t, seed: Number(e.target.value) } })} /></Field>
        <Field label="From reference column" hint="Leave empty for the whole reference"><input type="number" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To reference column"><input type="number" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="actions"><button className="primary" disabled={!version || !hasRun} onClick={() => attempt('Building tree', async () => setTree(await run(start && end ? { start: Number(start), end: Number(end) } : undefined)))}>Build tree</button></div>
      {tree && <><p className="muted">{tree.tips.length} haplotypes. Support is SH-aLRT / UFBoot, and values passing 80 and 95 are bold green. Compare branches only between sequences that share sites.</p><TreeFigure newick={tree.newick} labelFor={labelFor} thresholds={[80, 95]} /><div className="actions"><button onClick={() => attempt('Exporting', async () => {
        const rooted = profile.selection.outgroups.length > 0
        const phylogeny = treeToPhylogeny(tree.newick, { id: `${profile.id}-tree`, title: profile.title, version: new Date().toISOString().slice(0, 10), sources: [], rooted, lengthUnit: 'substitutions-per-site', sampling: 'partial', supportMethods: ['SH-aLRT', 'UFBoot'] })
        const path = `profiles/${profile.id}/exports/onetaxonomy-phylogeny.json`
        await platform.store.write(path, `${JSON.stringify(phylogeny, null, 2)}\n`)
        await platform.reveal(path)
      })}>Export for OneTaxonomy</button><span className="muted">A OneTaxonomy phylogeny record, with no taxon mappings until you add them.</span></div></>}
    </section>
  )
}
