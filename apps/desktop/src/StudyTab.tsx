import { type FoundPaper, NcbiClient, searchPapers } from '@captiveorigins/onephylogeny-acquire'
import { CompareRuns } from './CompareRuns'
import { confirmOutgroup, coverageTrack, dropOn, moveItem, newStudy, parseStudy, postHocOmissions, recordRun, restoreOmitted, studyMethods, studyUse, duplicateStudy, withoutPostHoc, type Curation, type MoveResult, type PanelWindow, type Profile, type Study, type StudyColumn, type StudyItem, type StudyPaper, type StudyRecord } from '@captiveorigins/onephylogeny-core'
import { findPaperRecords, findRecordStudies, isCancelled, profilePaths, type EngineContext } from '@captiveorigins/onephylogeny-engine'
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import type { Platform } from './platform'

/** Held by the app, so a search and an unsaved Study survive switching tabs. */
export type StudySession = {
  study: Study | null
  saved: boolean
  saveDeclined: boolean
  /** Changes since the last save, when autosave is off. */
  dirty: boolean
  results: FoundPaper[]
  columns: number | null
  searchNote: string | null
  selected: { kind: 'paper'; id: string } | { kind: 'record'; accession: string } | null
  promptRecordsFor: string | null
}
export const emptyStudySession: StudySession = { study: null, saved: false, saveDeclined: false, dirty: false, results: [], columns: null, searchNote: null, selected: null, promptRecordsFor: null }

/** The reference categorical palette, validated for color blindness, in fixed order. Past its end a paper goes gray, and it always keeps its label. */
const PAPER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
const OVERFLOW_COLOR = '#8a8a86'
const colorOf = (p: Pick<StudyPaper, 'colorIndex'>) => PAPER_COLORS[p.colorIndex] ?? OVERFLOW_COLOR

const now = () => new Date().toISOString()
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'study'

type Filters = { from: string; to: string; country: string; minRecords: string; onlyNew: boolean; openAccess: boolean; hideNotices: boolean; withLocality: boolean; hasRecords: boolean; after: string; regionFrom: string; regionTo: string }
const NO_FILTERS: Filters = { from: '', to: '', country: '', minRecords: '', onlyNew: false, openAccess: false, hideNotices: false, withLocality: false, hasRecords: false, after: '', regionFrom: '', regionTo: '' }

function PaperChip({ paper }: { paper: StudyPaper }) {
  return <span className="paper-chip"><span className="paper-dot" style={{ background: colorOf(paper) }} aria-hidden="true" />{paper.label}</span>
}

function Column({ id, title, count, onDropItem, children }: { id: StudyColumn; title: string; count?: number; onDropItem: (e: DragEvent, id: StudyColumn) => void; children: ReactNode }) {
  const [over, setOver] = useState(false)
  return (
    <section className={`study-col${over ? ' drop' : ''}`} aria-label={title} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onDropItem(e, id) }}>
      <h3>{title}{count !== undefined ? ` (${count})` : ''}</h3>
      {children}
    </section>
  )
}

/** Where each paper's records fall on the reference. Coordinates only: this never shows a group result. */
export function GeneRegion({ study, columns, windows }: { study: Study; columns: number; windows: PanelWindow[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const shown = study.papers.filter((p) => !hidden.has(p.id))
  const track = useMemo(() => coverageTrack(study, shown.map((p) => p.id), columns), [study, columns, shown.map((p) => p.id).join('|')])
  const W = 900, LABEL = 130, BAND = 14, GAP = 2
  const x = (c: number) => LABEL + (c / columns) * (W - LABEL)
  const runs = (on: boolean[]) => { const out: [number, number][] = []; let s = -1; on.forEach((v, i) => { if (v && s < 0) s = i; if (!v && s >= 0) { out.push([s, i]); s = -1 } }); if (s >= 0) out.push([s, on.length]); return out }
  const maxDepth = Math.max(1, ...track.depth)
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const height = 26 + (track.bands.length + 2) * (BAND + GAP) + 18
  return (
    <section className="gene-region" aria-label="Gene region">
      <h3>Gene region</h3>
      <div className="actions">
        <button onClick={() => setHidden(new Set())}>Show all</button>
        <button onClick={() => setHidden(new Set(study.papers.map((p) => p.id)))}>Hide all</button>
        {study.papers.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={!hidden.has(p.id)} onChange={() => toggle(p.id)} /> <PaperChip paper={p} /></label>)}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Coverage of ${columns} reference columns by ${shown.length} papers. The table below has the same numbers.`} className="gene-svg">
        {windows.map((w) => <g key={w.id}><line x1={x(w.start)} x2={x(w.start)} y1={14} y2={height - 16} className="gene-tick" /><text x={x(w.start) + 3} y={11} className="gene-text">{w.label}</text></g>)}
        {track.bands.map((b, i) => {
          const paper = study.papers.find((p) => p.id === b.paper)!
          const y = 18 + i * (BAND + GAP)
          return <g key={b.paper}><text x={LABEL - 6} y={y + 11} textAnchor="end" className="gene-text">{paper.label.slice(0, 20)}</text><rect x={LABEL} y={y} width={W - LABEL} height={BAND} className="gene-empty" />{runs(b.covered).map(([s, e]) => <rect key={s} x={x(s)} y={y} width={x(e) - x(s)} height={BAND} rx={3} fill={colorOf(paper)}><title>{paper.label}: columns {s + 1} to {e}, {b.records} records{b.unplaced ? `, ${b.unplaced} not placed` : ''}</title></rect>)}</g>
        })}
        {(() => {
          const y = 18 + track.bands.length * (BAND + GAP)
          return <g><text x={LABEL - 6} y={y + 11} textAnchor="end" className="gene-text">Depth (most {maxDepth})</text>{track.depth.map((d, c) => d > 0 && <rect key={c} x={x(c)} y={y + BAND - (BAND * d) / maxDepth} width={Math.max(0.6, x(c + 1) - x(c))} height={(BAND * d) / maxDepth} className="gene-depth" />)}
            <text x={LABEL - 6} y={y + BAND + GAP + 11} textAnchor="end" className="gene-text">Shared by all</text>{runs(track.shared).map(([s, e]) => <rect key={s} x={x(s)} y={y + BAND + GAP} width={x(e) - x(s)} height={BAND} rx={3} className="gene-shared"><title>Columns {s + 1} to {e} are covered by every paper shown</title></rect>)}</g>
        })()}
        <text x={LABEL} y={height - 3} className="gene-text">1</text><text x={W} y={height - 3} textAnchor="end" className="gene-text">{columns}</text>
      </svg>
      <details><summary>As a table</summary><table className="ophy-table"><thead><tr><th>Paper</th><th>Records</th><th>Not placed</th><th>Columns covered</th></tr></thead><tbody>
        {track.bands.map((b) => <tr key={b.paper}><th scope="row">{study.papers.find((p) => p.id === b.paper)?.label}</th><td>{b.records}</td><td>{b.unplaced}</td><td>{runs(b.covered).map(([s, e]) => `${s + 1}–${e}`).join(', ') || 'None'}</td></tr>)}
        <tr><th scope="row">Shared by all shown</th><td /><td /><td>{runs(track.shared).map(([s, e]) => `${s + 1}–${e}`).join(', ') || 'None'}</td></tr>
      </tbody></table></details>
    </section>
  )
}

export function StudyTab({ profile, platform, session, setSession, attempt, context, curation, decide, edit, save, busy }: {
  profile: Profile; platform: Platform; session: StudySession; setSession: (f: (s: StudySession) => StudySession) => void
  attempt: (l: string, w: () => Promise<void>) => Promise<void>; context: () => EngineContext; curation: Curation; decide: (c: Curation) => Promise<void>
  edit: (p: Profile) => void; save: (p?: Profile) => Promise<void>; busy: boolean
}) {
  const { study, results, columns } = session
  const P = profilePaths(profile.id)
  const dir = (id: string) => `${P.profile.replace(/\/profile\.json$/, '')}/studies/${id}`
  const [query, setQuery] = useState('')
  const [fromRecords, setFromRecords] = useState(true)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<{ item: StudyItem; drop?: StudyColumn; direction?: 'right' | 'left'; needs: 'reason' | 'confirm'; message: string; reason: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [existing, setExisting] = useState<string[]>([])
  const [saveName, setSaveName] = useState('')
  const [saveAuto, setSaveAuto] = useState(true)
  const [history, setHistory] = useState<string[] | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => { void platform.list(`${P.profile.replace(/\/profile\.json$/, '')}/studies`).then(setExisting).catch(() => setExisting([])) }, [platform, profile.id, session.saved])

  const write = async (s: Study) => {
    const d = dir(s.id)
    const text = `${JSON.stringify(s, null, 2)}\n`
    await platform.store.write(`${d}/study.json`, text)
    // One file per version, never overwritten, so a Study can go back to any point.
    const n = (await platform.list(`${d}/history`).catch(() => [] as string[])).length
    await platform.store.write(`${d}/history/${String(n + 1).padStart(6, '0')}.json`, text)
  }
  const commit = (next: Study) => {
    const persist = session.saved && next.autosave
    setSession((x) => ({ ...x, study: next, dirty: x.saved && !next.autosave }))
    if (persist) void write(next).then(() => setSaveError(null)).catch((e) => setSaveError(`Autosave failed, so this change isn't on disk: ${e instanceof Error ? e.message : String(e)}`))
  }
  const ensure = (): Study => study ?? newStudy(`study-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`, `${profile.title} study`, now())

  const lookUp = (paper: StudyPaper) => attempt(`Looking up records for ${paper.label}`, async () => {
    if (!paper.pmid || paper.linkLookup === 'done') return
    let linked: StudyPaper['linked'] = []
    let linkLookup: StudyPaper['linkLookup'] = 'done'
    try {
      const out = await findPaperRecords(context(), profile, paper.pmid)
      linked = out.linked
      setSession((x) => ({ ...x, columns: out.columns }))
    } catch (e) {
      if (isCancelled(e)) throw e
      linkLookup = 'failed'
    }
    const update = (p: FoundPaper) => (p.id === paper.id ? { ...p, linked, linkLookup } : p)
    setSession((x) => ({ ...x, results: x.results.map(update), study: x.study ? { ...x.study, papers: x.study.papers.map((p) => (p.id === paper.id ? { ...p, linked, linkLookup } : p)) } : x.study }))
  })

  const handle = (r: MoveResult, item: StudyItem, extra: { drop?: StudyColumn; direction?: 'right' | 'left' }, before: Study) => {
    if (r.outcome === 'moved') {
      setPending(null); setMessage(null)
      commit(r.study)
      if (item.kind === 'result' && r.study.papers.length > before.papers.length) {
        const usable = item.paper.linked.filter((l) => l.hasMarker).length
        const records = Object.keys(r.study.records).length > Object.keys(before.records).length
        setSession((x) => ({ ...x, ...(usable && !records ? { promptRecordsFor: item.paper.id } : {}) }))
      }
      return
    }
    if (r.outcome === 'no-move') { setMessage(r.message); return }
    setPending({ item, ...extra, needs: r.outcome === 'needs-reason' ? 'reason' : 'confirm', message: r.message, reason: '' })
  }
  const move = (item: StudyItem, direction: 'right' | 'left', o: { reason?: string; confirmed?: boolean } = {}) => {
    const s = ensure()
    handle(moveItem(s, item, direction, { at: now(), ...o }), item, { direction }, s)
  }
  const drop = (item: StudyItem, target: StudyColumn, o: { reason?: string; confirmed?: boolean } = {}) => {
    const s = ensure()
    handle(dropOn(s, item, target, { at: now(), ...o }), item, { drop: target }, s)
  }
  const finishPending = (o: { reason?: string; confirmed?: boolean }) => {
    if (!pending) return
    if (pending.drop) drop(pending.item, pending.drop, o)
    else move(pending.item, pending.direction!, o)
  }
  const dragStart = (e: DragEvent, item: StudyItem) => { e.dataTransfer.setData('text/plain', JSON.stringify(item.kind === 'result' ? { kind: 'result', id: item.paper.id } : item)); e.dataTransfer.effectAllowed = 'move' }
  const onDrop = (e: DragEvent, target: StudyColumn) => {
    let raw: { kind: string; id?: string; accession?: string }
    try { raw = JSON.parse(e.dataTransfer.getData('text/plain')) } catch { return }
    if (raw.kind === 'result') { const paper = results.find((p) => p.id === raw.id); if (paper) drop({ kind: 'result', paper }, target) }
    else if (raw.kind === 'paper' && raw.id) drop({ kind: 'paper', id: raw.id }, target)
    else if (raw.kind === 'record' && raw.accession) drop({ kind: 'record', accession: raw.accession }, target)
  }

  const search = () => attempt('Searching for papers', async () => {
    const ctx = context()
    const client = new NcbiClient(ctx.ncbi)
    let recordPapers: FoundPaper[] = []
    let cols = columns
    const failed: string[] = []
    if (fromRecords) {
      try { const r = await findRecordStudies(ctx, profile); recordPapers = r.papers; cols = r.columns } catch (e) {
        if (isCancelled(e)) throw e
        failed.push(`GenBank studies: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const out = await searchPapers(client, platform.fetch, query.trim(), recordPapers)
    const allFailed = [...failed, ...out.failed]
    const label = [query.trim() || null, fromRecords ? `GenBank records for ${profile.selection.title}` : null].filter(Boolean).join(' + ')
    const short = Object.entries(out.totals).filter(([k, t]) => t > (out.counts[k] ?? 0)).map(([k, t]) => `${k} showed ${out.counts[k]} of ${t}`)
    const entry = { at: now(), query: label, sources: out.sources, counts: out.counts, ...(allFailed.length ? { failed: allFailed } : {}) }
    setSession((x) => ({
      ...x, results: out.papers, columns: cols,
      searchNote: `${out.papers.length} papers. ${Object.entries(out.counts).map(([k, n]) => `${k} ${n}`).join(', ')}.${short.length ? ` Cut short: ${short.join(', ')}. Narrow the search to see the rest.` : ''}${allFailed.length ? ` Failed, so this list is incomplete: ${allFailed.join('; ')}.` : ''}`,
      // A search before a Study exists is kept with the Study once there is one, so the log stays complete.
      study: x.study ? { ...x.study, searches: [...x.study.searches, entry] } : x.study,
    }))
    setPendingSearches((p) => (study ? p : [...p, entry]))
  })
  const [pendingSearches, setPendingSearches] = useState<Study['searches']>([])
  useEffect(() => {
    if (study && pendingSearches.length) { setSession((x) => (x.study ? { ...x, study: { ...x.study, searches: [...pendingSearches, ...x.study.searches] } } : x)); setPendingSearches([]) }
  }, [study, pendingSearches])

  const inStudy = useMemo(() => new Set(study?.papers.map((p) => p.id) ?? []), [study])
  const shownResults = useMemo(() => results.filter((p) => {
    const f = filters
    const count = p.linked.filter((l) => l.hasMarker).length
    if (f.from && (p.year ?? 0) < Number(f.from)) return false
    if (f.to && (p.year ?? 9999) > Number(f.to)) return false
    if (f.country && !p.linked.some((l) => l.country?.toLowerCase().includes(f.country.toLowerCase()))) return false
    if (f.minRecords && count < Number(f.minRecords)) return false
    if (f.hasRecords && !count) return false
    if (f.onlyNew && !p.linked.some((l) => l.hasMarker && !study?.records[l.accession])) return false
    if (f.openAccess && !p.openAccess) return false
    if (f.hideNotices && p.notices?.length) return false
    if (f.withLocality && !p.linked.some((l) => l.country)) return false
    if (f.after && (p.year ?? 0) < Number(f.after)) return false
    if (f.regionFrom || f.regionTo) {
      const a = Number(f.regionFrom || 1) - 1, b = Number(f.regionTo || columns || 1e9)
      if (!p.linked.some((l) => l.span && l.span[0] < b && l.span[1] > a)) return false
    }
    return true
  }), [results, filters, study, columns])

  const records = study ? Object.values(study.records) : []
  const ingroup = records.filter((r) => r.column === 'ingroup')
  const outgroup = records.filter((r) => r.column === 'outgroup')
  const paperOf = (id: string) => study?.papers.find((p) => p.id === id)
  const sel = session.selected
  const litPaper = (id: string) => !!sel && (sel.kind === 'paper' ? sel.id === id : !!study?.records[sel.accession]?.papers.includes(id))
  const litRecord = (r: StudyRecord) => !!sel && (sel.kind === 'record' ? sel.accession === r.accession || r.papers.some((p) => study?.records[sel.accession]?.papers.includes(p)) : r.papers.includes(sel.id))
  const select = (s: StudySession['selected']) => setSession((x) => ({ ...x, selected: JSON.stringify(x.selected) === JSON.stringify(s) ? null : s }))
  const notThisGene = (p: StudyPaper) => p.linked.filter((l) => !l.hasMarker).length

  const row = (r: StudyRecord) => (
    <li key={r.accession} draggable onDragStart={(e) => dragStart(e, { kind: 'record', accession: r.accession })} className={`study-row${r.omitted ? ' omitted' : ''}${litRecord(r) ? ' lit' : ''}`}>
      <div className="row-actions">
        <button aria-label={`Move ${r.accession} left`} title={r.column === 'outgroup' ? 'Back to Ingroup' : r.papers.length ? 'Omit, with a reason' : 'Remove'} disabled={Boolean(r.omitted)} onClick={() => move({ kind: 'record', accession: r.accession }, 'left')}>−</button>
        <button aria-label={`Move ${r.accession} right`} title="To Outgroup" disabled={r.column === 'outgroup' || Boolean(r.omitted)} onClick={() => move({ kind: 'record', accession: r.accession }, 'right')}>+</button>
      </div>
      <button className="link" onClick={() => select({ kind: 'record', accession: r.accession })}>{r.accession}</button>
      <span className="muted"> {r.organism}{r.span ? `, columns ${r.span[0] + 1}–${r.span[1]}` : ', not placed'}</span>
      <div>{r.papers.map((id) => { const p = paperOf(id); return p ? <PaperChip key={id} paper={p} /> : null })}{r.proposed && <span className="badge">Other species in this paper</span>}{r.proposed && <button onClick={() => commit(confirmOutgroup(study!, r.accession, now()))}>Confirm outgroup</button>}</div>
      {r.omitted && <div className="muted">Omitted {r.omitted.timing === 'after-result' ? 'after a result (post hoc)' : 'before any result'}: {r.omitted.reason} <button onClick={() => commit(restoreOmitted(study!, r.accession, now()))}>Restore</button></div>}
    </li>
  )

  const use = study ? studyUse(study) : null
  const useStudy = () => attempt('Setting up the next fetch from this Study', async () => {
    if (!study || !use || use.blocked.length) return
    const run = { id: `use-${Date.now()}`, at: now(), stateHash: use.stateHash, ...(profile.panel ? { profileVersion: profile.panel.version } : {}) }
    const next = recordRun(study, run)
    const d = dir(next.id)
    // Frozen apart from autosave, so later edits can't change what this run meant.
    await platform.store.write(`${d}/frozen/${use.stateHash.replace(/^sha256:/, '')}.json`, `${JSON.stringify(next, null, 2)}\n`)
    await write(next)
    // Keeps the outgroups the profile already had, unless the Study puts one in the ingroup.
    const chosen = new Set([...use.include, ...use.outgroups.map((o) => o.accession)])
    const kept = profile.selection.outgroups.filter((o) => !o.accession || !chosen.has(o.accession))
    const nextProfile: Profile = { ...profile, selection: { ...profile.selection, include: use.include, fromStudy: use.link, outgroups: [...kept, ...use.outgroups] } }
    edit(nextProfile)
    await save(nextProfile)
    const recs = { ...curation.records }
    // Keeps any study label a person already set, since those were corrected by hand.
    for (const [a, label] of Object.entries(use.studyOf)) if (!recs[a]?.study) recs[a] = { ...recs[a], study: label }
    await decide({ ...curation, records: recs })
    setSession((x) => ({ ...x, study: next, saved: true }))
    setMessage('Set. Open Records and fetch, then build a panel with a new version number. Records still pass every check. Omissions from here on are labeled post hoc.')
  })

  // A copy gets its own id, so the original and its frozen runs stay exactly as they were.
  const copyWith = (make: (s: Study, id: string, title: string, at: string) => Study, suffix: string, note: string) => attempt('Copying the Study', async () => {
    if (!study) return
    const copy = make(study, `${study.id}-${slug(suffix)}-${Date.now()}`, `${study.title} (${suffix})`, now())
    await write(copy)
    setSession((x) => ({ ...x, study: copy, saved: true, saveDeclined: false, selected: null }))
    setMessage(note)
  })
  const postHoc = study ? postHocOmissions(study) : []

  const firstPrompt = study && study.papers.length > 0 && !session.saved && !session.saveDeclined
  const promptPaper = session.promptRecordsFor ? paperOf(session.promptRecordsFor) : null
  const openStudy = (id: string) => attempt('Opening the Study', async () => {
    const s = parseStudy(await platform.store.read(`${dir(id)}/study.json`))
    setSession((x) => ({ ...x, study: s, saved: true, saveDeclined: false, selected: null }))
  })
  const showHistory = async () => { if (study) setHistory(await platform.list(`${dir(study.id)}/history`).catch(() => [])) }
  const restore = (version: string) => attempt('Restoring', async () => {
    if (!study) return
    const old = parseStudy(await platform.store.read(`${dir(study.id)}/history/${version}`))
    // Restoring adds a version, so the versions after it stay available. The list of runs never shrinks, so nothing can be hidden this way.
    const restored: Study = { ...old, runs: study.runs, searches: study.searches, log: [...study.log, { at: now(), action: 'restored-version', item: version }] }
    await write(restored)
    setSession((x) => ({ ...x, study: restored }))
    setHistory(null)
  })
  const exportMethods = () => attempt('Saving methods', async () => {
    if (!study) return
    const path = `${dir(study.id)}/methods.md`
    await platform.store.write(path, studyMethods(study))
    await platform.reveal(path)
  })
  const F = (k: keyof Filters) => ({ value: filters[k] as string, onChange: (e: { target: { value: string } }) => setFilters({ ...filters, [k]: e.target.value }) })
  const C = (k: keyof Filters) => ({ checked: filters[k] as boolean, onChange: (e: { target: { checked: boolean } }) => setFilters({ ...filters, [k]: e.target.checked }) })

  return (
    <div className="study">
      <div className="study-bar">
        <form className="row" onSubmit={(e) => { e.preventDefault(); void search() }}>
          <label className="field"><span>Search papers</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Species, gene, author, any words" /></label>
          <label className="check"><input type="checkbox" checked={fromRecords} onChange={(e) => setFromRecords(e.target.checked)} /> Include studies from GenBank records for this profile</label>
          <button type="submit" className="primary" disabled={busy || (!query.trim() && !fromRecords)}>Search</button>
        </form>
        {session.searchNote && <p role="status" className="muted">{session.searchNote}</p>}
        <div className="actions">
          {study
            ? <>
                <input aria-label="Study name" value={study.title} onChange={(e) => commit({ ...study, title: e.target.value })} />
                <span className={session.saved && !session.dirty ? 'muted' : 'badge warn'}>{!session.saved ? 'Not saved' : session.dirty ? 'Unsaved changes' : study.autosave ? 'Autosaving' : 'Saved'}</span>
                {session.saved && <><label className="check"><input type="checkbox" checked={study.autosave} onChange={(e) => commit({ ...study, autosave: e.target.checked })} /> Autosave</label>{!study.autosave && <button onClick={() => attempt('Saving', async () => { await write(study); setSession((x) => ({ ...x, dirty: false })) })}>Save now</button>}<button onClick={() => void showHistory()}>History</button><button onClick={exportMethods}>Export methods</button></>}
                <span className="muted">{study.runs.length} runs recorded</span>
              </>
            : existing.length > 0 && <>{existing.map((id) => <button key={id} onClick={() => openStudy(id)}>Open {id}</button>)}</>}
        </div>
        {saveError && <p role="alert" className="error">{saveError}</p>}
        {message && <p role="status" className="muted">{message}</p>}
        {history && <div className="inline-prompt"><strong>Earlier versions</strong>{history.length === 0 && <span className="muted"> None yet.</span>}<ul className="plain">{history.slice(-20).reverse().map((v) => <li key={v}><button onClick={() => restore(v)}>Restore {v.replace('.json', '')}</button></li>)}</ul><button onClick={() => setHistory(null)}>Close</button></div>}
        {firstPrompt && <form className="inline-prompt" onSubmit={(e) => { e.preventDefault(); void attempt('Saving the Study', async () => {
          const named: Study = { ...study!, id: slug(saveName || study!.title) === 'study' ? study!.id : slug(saveName || study!.title), title: saveName.trim() || study!.title, autosave: saveAuto }
          await write(named)
          setSession((x) => ({ ...x, study: named, saved: true }))
        }) }}>
          <strong>Save this Study?</strong>
          <label className="field"><span>Name</span><input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={study!.title} /></label>
          <label className="check"><input type="checkbox" checked={saveAuto} onChange={(e) => setSaveAuto(e.target.checked)} /> Autosave as you work</label>
          <div className="actions"><button type="submit" className="primary">Save</button><button type="button" onClick={() => setSession((x) => ({ ...x, saveDeclined: true }))}>Not now</button></div>
        </form>}
        {promptPaper && <div className="inline-prompt"><strong>Add the {promptPaper.linked.filter((l) => l.hasMarker).length} records linked to {promptPaper.label}?</strong> <div className="actions"><button className="primary" onClick={() => { setSession((x) => ({ ...x, promptRecordsFor: null })); move({ kind: 'paper', id: promptPaper.id }, 'right') }}>Add records</button><button onClick={() => setSession((x) => ({ ...x, promptRecordsFor: null }))}>Not now</button></div></div>}
        {pending && <form className="inline-prompt" onSubmit={(e) => { e.preventDefault(); finishPending(pending.needs === 'reason' ? { reason: pending.reason } : { confirmed: true }) }}>
          <strong>{pending.message}</strong>
          {pending.needs === 'reason' && <label className="field"><span>Reason</span><input autoFocus value={pending.reason} onChange={(e) => setPending({ ...pending, reason: e.target.value })} /></label>}
          {pending.needs === 'reason' && Boolean(study?.runs.length) && <p className="muted">A run has been recorded, so this omission will be labeled post hoc.</p>}
          <div className="actions"><button type="submit" className="primary" disabled={pending.needs === 'reason' && !pending.reason.trim()}>{pending.needs === 'reason' ? 'Omit' : 'Remove'}</button><button type="button" onClick={() => setPending(null)}>Cancel</button></div>
        </form>}
      </div>

      <div className="study-grid">
        <aside className="study-col filters" aria-label="Filters">
          <h3>Filters</h3>
          <p className="muted">{profile.selection.title}</p>
          <div className="row"><label className="field"><span>From year</span><input type="number" {...F('from')} /></label><label className="field"><span>To year</span><input type="number" {...F('to')} /></label></div>
          <label className="field"><span>Country</span><input {...F('country')} /></label>
          <label className="field"><span>At least this many records</span><input type="number" min={0} {...F('minRecords')} /></label>
          <div className="row"><label className="field"><span>Gene region, from column</span><input type="number" min={1} {...F('regionFrom')} /></label><label className="field"><span>to column</span><input type="number" min={1} {...F('regionTo')} /></label></div>
          <label className="field"><span>Published in or after this year</span><input type="number" {...F('after')} /><small>To hold papers aside for a confirmatory test, check the release date as well, since this compares years only</small></label>
          <label className="check"><input type="checkbox" {...C('hasRecords')} /> Has records of this marker</label>
          <label className="check"><input type="checkbox" {...C('onlyNew')} /> Has records new to this Study</label>
          <label className="check"><input type="checkbox" {...C('withLocality')} /> Has records naming a place</label>
          <label className="check"><input type="checkbox" {...C('openAccess')} /> Open access</label>
          <label className="check"><input type="checkbox" {...C('hideNotices')} /> Hide retracted or corrected</label>
          <button onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>
          <p className="muted">{shownResults.length} of {results.length} shown</p>
        </aside>

        <Column id="results" title="Search results" count={shownResults.length} onDropItem={onDrop}>
          {!results.length && <p className="muted">Search to list papers and how many records each has. Most records have no PubMed link, so GenBank studies are included.</p>}
          <ul className="plain">{shownResults.map((p) => {
            const added = inStudy.has(p.id)
            const usable = p.linked.filter((l) => l.hasMarker).length
            const open = expanded === p.id
            return <li key={p.id} draggable={!added} onDragStart={(e) => dragStart(e, { kind: 'result', paper: p })} className={`study-row${added ? ' in-study' : ''}`}>
              <div className="row-actions"><button aria-label={`Add ${p.title}`} disabled={added} onClick={() => move({ kind: 'result', paper: p }, 'right')}>+</button></div>
              <button className="link" aria-expanded={open} onClick={() => { setExpanded(open ? null : p.id); if (!open && p.linkLookup === 'not-done' && p.pmid) void lookUp(p) }}>{p.title}</button>
              <div className="muted">{[p.label, p.journal].filter(Boolean).join(', ')}</div>
              <div>
                <span className="badge">{p.linkLookup === 'done' ? `${usable} records` : p.linkLookup === 'failed' ? 'Lookup failed' : 'Records not looked up'}</span>
                {p.sources.map((s) => <span key={s} className="badge">{s}</span>)}
                {p.openAccess && <span className="badge">Open access</span>}
                {p.unpublished && <span className="badge">No publication</span>}
                {p.notices?.map((n) => <span key={n} className="badge warn">{n}</span>)}
                {added && <span className="badge">In Study</span>}
              </div>
              {open && <div className="expanded">
                {p.authors && <p className="muted">{p.authors}</p>}
                {p.doi && <p className="muted">doi:{p.doi}</p>}
                {p.linkLookup === 'done' && !p.linked.length && <p className="muted">No linked records found. That isn't the same as the paper having none, because most records aren't linked.</p>}
                {notThisGene(p) > 0 && <p className="muted">{notThisGene(p)} other records are not this gene.</p>}
                {p.possibleSameAs?.length ? <p className="muted">Another entry has the same title. They stay separate until someone checks: {p.possibleSameAs.join(', ')}</p> : null}
                {columns && usable > 0 && (() => { const spans = p.linked.filter((l) => l.span); return spans.length ? <p className="muted">Covers columns {Math.min(...spans.map((l) => l.span![0])) + 1} to {Math.max(...spans.map((l) => l.span![1]))} of {columns}.</p> : null })()}
              </div>}
            </li>
          })}</ul>
        </Column>

        <Column id="papers" title="Papers" count={study?.papers.length ?? 0} onDropItem={onDrop}>
          {!study?.papers.length && <p className="muted">Use + or drag a paper here.</p>}
          <ul className="plain">{study?.papers.map((p) => {
            const rs = records.filter((r) => r.papers.includes(p.id))
            const omitted = rs.filter((r) => r.omitted).length
            return <li key={p.id} draggable onDragStart={(e) => dragStart(e, { kind: 'paper', id: p.id })} className={`study-row${litPaper(p.id) ? ' lit' : ''}`}>
              <div className="row-actions">
                <button aria-label={`Remove ${p.label}`} onClick={() => move({ kind: 'paper', id: p.id }, 'left')}>−</button>
                <button aria-label={`Add records of ${p.label}`} disabled={p.linkLookup !== 'done' && !p.pmid} onClick={() => p.linkLookup === 'done' ? move({ kind: 'paper', id: p.id }, 'right') : void lookUp(p)}>+</button>
              </div>
              <button className="link" onClick={() => select({ kind: 'paper', id: p.id })}><PaperChip paper={p} /></button>
              <div className="muted">{rs.length} of {p.linked.filter((l) => l.hasMarker).length} records added{omitted ? `, ${omitted} omitted` : ''}{notThisGene(p) ? `, ${notThisGene(p)} not this gene` : ''}</div>
            </li>
          })}</ul>
        </Column>

        <Column id="ingroup" title="Ingroup" count={ingroup.filter((r) => !r.omitted).length} onDropItem={onDrop}><ul className="plain">{ingroup.map(row)}</ul></Column>
        <Column id="outgroup" title="Outgroup" count={outgroup.filter((r) => !r.omitted).length} onDropItem={onDrop}>
          {!outgroup.length && <p className="muted">GenBank doesn't label outgroups, so other species in a paper are proposed here until you confirm them.</p>}
          <ul className="plain">{outgroup.map(row)}</ul>
        </Column>
      </div>

      {study && columns && study.papers.length > 0 && <GeneRegion study={study} columns={columns} windows={profile.panel?.windows ?? []} />}

      {study && postHoc.length > 0 && <div className="inline-prompt" role="status">
        <strong>{postHoc.length} {postHoc.length === 1 ? 'record was' : 'records were'} omitted after a result was seen.</strong> Show the results both ways: make a copy with them restored, use it for a fetch, build a new version, then compare the two below.
        <div className="actions"><button onClick={() => copyWith(withoutPostHoc, 'without post hoc omissions', 'This copy has the post hoc omissions restored. The original is unchanged.')}>Make a copy without post hoc omissions</button></div>
      </div>}

      {study && use && <div className="actions study-use">
        <button className="primary" disabled={busy || use.blocked.length > 0} onClick={useStudy}>Use this Study for the next fetch</button>
        <span className="muted">{use.blocked.length ? use.blocked.join('. ') : `${use.include.length} ingroup and ${use.outgroups.length} outgroup records. The profile will fetch exactly these, and they'll pass the same checks as any record.`}</span>
        <button disabled={busy} onClick={() => copyWith(duplicateStudy, 'copy', 'This is a copy, with the runs it came from still listed. Omissions in it are labeled post hoc too, because those results were seen.')}>Duplicate this Study</button>
      </div>}

      <CompareRuns profile={profile} platform={platform} attempt={attempt} busy={busy} />
    </div>
  )
}
