import { canonicalJson } from './panel.js'
import { sha256Hex } from './sha256.js'

/**
 * A Study: papers gathered for an analysis, with their records sorted into ingroup and outgroup.
 * Every move goes through `moveItem`, so the buttons and dragging can't disagree. Design: docs/architecture/study-workspace.md.
 */
export type StudyColumn = 'results' | 'papers' | 'ingroup' | 'outgroup'

/** A record a paper links to, before anyone has added it. */
export type LinkedRecord = {
  accession: string
  organism?: string
  length?: number
  title?: string
  /** Of the Study's target taxa. Anything else is proposed as an outgroup, because GenBank doesn't label outgroups. */
  inTarget: boolean
  /** Holds the Study's marker. Records of other genes are listed but never placed, and don't count as omissions. */
  hasMarker: boolean
  country?: string
  /** Reference columns covered, half open. Absent until placed. */
  span?: [number, number]
}

export type StudyPaper = {
  id: string
  label: string
  /** Position in the fixed palette. Colors run out, so a paper is also always shown with its label. */
  colorIndex: number
  title: string
  authors?: string
  journal?: string
  year?: number
  doi?: string
  pmid?: string
  sources: ('pubmed' | 'europepmc' | 'genbank')[]
  /** A GenBank submission with no publication of its own. */
  unpublished?: boolean
  openAccess?: boolean
  notices?: string[]
  linked: LinkedRecord[]
  /** Whether the records have been looked up. "None found" and "not looked" are different answers. */
  linkLookup: 'not-done' | 'done' | 'failed'
}

export type StudyRecord = LinkedRecord & {
  /** Every paper citing it: a record cited twice counts once. Empty if added by hand. */
  papers: string[]
  column: 'ingroup' | 'outgroup'
  /** An outgroup nobody has confirmed yet. It can't be used in a run. */
  proposed?: boolean
  omitted?: { reason: string; timing: 'before-result' | 'after-result'; at: string }
}

export type StudyEvent = { at: string; action: string; item?: string; detail?: string }
export type StudySearch = { at: string; query: string; sources: string[]; counts: Record<string, number>; failed?: string[] }
export type StudyRun = { id: string; at: string; stateHash: string; profileVersion?: string }

export type Study = {
  schemaVersion: 1
  id: string
  title: string
  createdAt: string
  autosave: boolean
  papers: StudyPaper[]
  records: Record<string, StudyRecord>
  searches: StudySearch[]
  runs: StudyRun[]
  log: StudyEvent[]
}

export type StudyItem = { kind: 'result'; paper: StudyPaper } | { kind: 'paper'; id: string } | { kind: 'record'; accession: string }
export type MoveOptions = { reason?: string; confirmed?: boolean; at: string }
export type MoveResult = { outcome: 'moved'; study: Study } | { outcome: 'needs-reason' | 'needs-confirmation' | 'no-move'; study: Study; message: string }

export const STUDY_COLUMNS: StudyColumn[] = ['results', 'papers', 'ingroup', 'outgroup']

export function newStudy(id: string, title: string, at: string): Study {
  return { schemaVersion: 1, id, title, createdAt: at, autosave: true, papers: [], records: {}, searches: [], runs: [], log: [] }
}

const logged = (s: Study, e: StudyEvent): Study => ({ ...s, log: [...s.log, e] })

export function itemColumn(study: Study, item: StudyItem): StudyColumn | null {
  if (item.kind === 'result') return study.papers.some((p) => p.id === item.paper.id) ? 'papers' : 'results'
  if (item.kind === 'paper') return study.papers.some((p) => p.id === item.id) ? 'papers' : null
  return study.records[item.accession]?.column ?? null
}

function addPaper(s: Study, paper: StudyPaper, at: string): Study {
  if (s.papers.some((p) => p.id === paper.id)) return s
  const colorIndex = s.papers.reduce((n, p) => Math.max(n, p.colorIndex + 1), 0)
  return logged({ ...s, papers: [...s.papers, { ...paper, colorIndex }] }, { at, action: 'paper-added', item: paper.id })
}

/** Adds a paper's records. Records of another gene stay listed under the paper, and aren't placed. */
export function addPaperRecords(s: Study, paperId: string, at: string): Study {
  const paper = s.papers.find((p) => p.id === paperId)
  if (!paper) return s
  const records = { ...s.records }
  let added = 0
  for (const r of paper.linked) {
    if (!r.hasMarker) continue
    const existing = records[r.accession]
    if (existing) {
      if (!existing.papers.includes(paperId)) records[r.accession] = { ...existing, papers: [...existing.papers, paperId] }
      continue
    }
    records[r.accession] = { ...r, papers: [paperId], column: r.inTarget ? 'ingroup' : 'outgroup', ...(r.inTarget ? {} : { proposed: true }) }
    added++
  }
  return logged({ ...s, records }, { at, action: 'records-added', item: paperId, detail: `${added} records` })
}

/** Removes a paper. A record another paper also cites stays, and hand-added records aren't touched. */
function removePaper(s: Study, paperId: string, at: string): Study {
  const records: Study['records'] = {}
  for (const [k, r] of Object.entries(s.records)) {
    if (!r.papers.includes(paperId)) { records[k] = r; continue }
    const rest = r.papers.filter((p) => p !== paperId)
    if (rest.length) records[k] = { ...r, papers: rest }
  }
  return logged({ ...s, papers: s.papers.filter((p) => p.id !== paperId), records }, { at, action: 'paper-removed', item: paperId })
}

/** One column to the right: the `+` button, and dragging rightward. */
export function moveRight(s: Study, item: StudyItem, o: MoveOptions): MoveResult {
  if (item.kind === 'result') {
    if (s.papers.some((p) => p.id === item.paper.id)) return { outcome: 'no-move', study: s, message: 'This paper is already in the Study' }
    return { outcome: 'moved', study: addPaper(s, item.paper, o.at) }
  }
  if (item.kind === 'paper') {
    const paper = s.papers.find((p) => p.id === item.id)
    if (!paper) return { outcome: 'no-move', study: s, message: 'This paper isn\'t in the Study' }
    return { outcome: 'moved', study: addPaperRecords(s, item.id, o.at) }
  }
  const r = s.records[item.accession]
  if (!r) return { outcome: 'no-move', study: s, message: 'This record isn\'t in the Study' }
  if (r.column === 'outgroup') return { outcome: 'no-move', study: s, message: 'Outgroup is the last column' }
  return { outcome: 'moved', study: logged({ ...s, records: { ...s.records, [r.accession]: { ...r, column: 'outgroup' } } }, { at: o.at, action: 'moved-to-outgroup', item: r.accession }) }
}

/** One column to the left: the `−` button, and dragging leftward. */
export function moveLeft(s: Study, item: StudyItem, o: MoveOptions): MoveResult {
  if (item.kind === 'result') return { outcome: 'no-move', study: s, message: 'Search results are the first column' }
  if (item.kind === 'paper') {
    if (!s.papers.some((p) => p.id === item.id)) return { outcome: 'no-move', study: s, message: 'This paper isn\'t in the Study' }
    if (!o.confirmed) return { outcome: 'needs-confirmation', study: s, message: 'This removes the paper and its records from the Study' }
    return { outcome: 'moved', study: removePaper(s, item.id, o.at) }
  }
  const r = s.records[item.accession]
  if (!r) return { outcome: 'no-move', study: s, message: 'This record isn\'t in the Study' }
  if (r.column === 'outgroup') {
    const { proposed: _p, ...rest } = r
    return { outcome: 'moved', study: logged({ ...s, records: { ...s.records, [r.accession]: { ...rest, column: 'ingroup' } } }, { at: o.at, action: 'moved-to-ingroup', item: r.accession }) }
  }
  if (!r.papers.length) {
    const { [r.accession]: _gone, ...records } = s.records
    return { outcome: 'moved', study: logged({ ...s, records }, { at: o.at, action: 'hand-added-removed', item: r.accession }) }
  }
  return omit(s, r.accession, o)
}

/** Omitting needs a written reason. Once any run exists, it's labeled after-result, and nobody can turn that off. */
export function omit(s: Study, accession: string, o: MoveOptions): MoveResult {
  const r = s.records[accession]
  if (!r) return { outcome: 'no-move', study: s, message: 'This record isn\'t in the Study' }
  if (r.omitted) return { outcome: 'no-move', study: s, message: 'This record is already omitted' }
  const reason = o.reason?.trim()
  if (!reason) return { outcome: 'needs-reason', study: s, message: 'Say why this record is being omitted. The reason is kept' }
  const timing = s.runs.length ? 'after-result' as const : 'before-result' as const
  return { outcome: 'moved', study: logged({ ...s, records: { ...s.records, [accession]: { ...r, omitted: { reason, timing, at: o.at } } } }, { at: o.at, action: 'omitted', item: accession, detail: `${timing}: ${reason}` }) }
}

export function restoreOmitted(s: Study, accession: string, at: string): Study {
  const r = s.records[accession]
  if (!r?.omitted) return s
  const { omitted, ...rest } = r
  return logged({ ...s, records: { ...s.records, [accession]: rest } }, { at, action: 'restored', item: accession, detail: `was omitted ${omitted.timing}: ${omitted.reason}` })
}

export function confirmOutgroup(s: Study, accession: string, at: string): Study {
  const r = s.records[accession]
  if (!r?.proposed) return s
  const { proposed: _p, ...rest } = r
  return logged({ ...s, records: { ...s.records, [accession]: rest } }, { at, action: 'outgroup-confirmed', item: accession })
}

/** Dropping on a column does what the buttons do, one step at a time, and dropping a record on Papers omits it. */
export function dropOn(s: Study, item: StudyItem, target: StudyColumn, o: MoveOptions): MoveResult {
  const from = itemColumn(s, item)
  if (from === null && item.kind !== 'result') return { outcome: 'no-move', study: s, message: 'This item isn\'t in the Study' }
  if (item.kind === 'record' && target === 'results') return { outcome: 'no-move', study: s, message: 'A record can\'t go to search results. Drop it on Papers to omit it' }
  if (item.kind === 'record' && target === 'papers') {
    const r = s.records[item.accession]
    return r && !r.papers.length ? moveLeft(s, item, o) : omit(s, item.accession, o)
  }
  const step = STUDY_COLUMNS.indexOf(target) - STUDY_COLUMNS.indexOf(from ?? 'results')
  if (step === 0) return { outcome: 'no-move', study: s, message: 'It\'s already there' }
  if (item.kind === 'paper' && target === 'outgroup') return { outcome: 'no-move', study: s, message: 'Drop a paper on Ingroup. Its other species are proposed as outgroups' }
  if (item.kind === 'result' && step > 1) {
    const first = moveRight(s, item, o)
    return first.outcome === 'moved' ? moveRight(first.study, { kind: 'paper', id: item.paper.id }, o) : first
  }
  return step > 0 ? moveRight(s, item, o) : moveLeft(s, item, o)
}

export const moveItem = (s: Study, item: StudyItem, direction: 'right' | 'left', o: MoveOptions): MoveResult => (direction === 'right' ? moveRight(s, item, o) : moveLeft(s, item, o))

/** Depth per reference column, for the papers chosen, plus the columns every chosen paper covers. Uses coordinates only. */
export function coverageTrack(s: Study, paperIds: string[], columns: number): { depth: number[]; shared: boolean[]; bands: { paper: string; covered: boolean[]; records: number; unplaced: number }[] } {
  const depth = new Array<number>(columns).fill(0)
  const live = Object.values(s.records).filter((r) => !r.omitted)
  const bands = paperIds.map((paper) => {
    const covered = new Array<boolean>(columns).fill(false)
    const rs = live.filter((r) => r.papers.includes(paper))
    let unplaced = 0
    for (const r of rs) {
      if (!r.span) { unplaced++; continue }
      for (let i = Math.max(0, r.span[0]); i < Math.min(columns, r.span[1]); i++) covered[i] = true
    }
    return { paper, covered, records: rs.length, unplaced }
  })
  // A shared record counts once, however many chosen papers cite it.
  for (const r of live) {
    if (!r.span || !r.papers.some((p) => paperIds.includes(p))) continue
    for (let i = Math.max(0, r.span[0]); i < Math.min(columns, r.span[1]); i++) depth[i]!++
  }
  const shared = depth.map((_, i) => bands.length > 0 && bands.every((b) => b.covered[i]))
  return { depth, shared, bands }
}

export type StudyUse = {
  include: string[]
  outgroups: { accession: string; rationale: string }[]
  /** Which study each record belongs to, so the across-studies gate can see the Study's papers. */
  studyOf: Record<string, string>
  stateHash: string
  blocked: string[]
}

/** What a run would use. It refuses unconfirmed outgroups, so a proposal can't quietly root a tree. */
export function studyUse(s: Study): StudyUse {
  const labelOf = new Map(s.papers.map((p) => [p.id, p.label]))
  const live = Object.values(s.records).filter((r) => !r.omitted)
  const include = live.filter((r) => r.column === 'ingroup').map((r) => r.accession).sort()
  const outgroups = live.filter((r) => r.column === 'outgroup' && !r.proposed).map((r) => ({ accession: r.accession, rationale: `Chosen in Study ${s.title}${r.papers[0] ? `, from ${labelOf.get(r.papers[0]) ?? r.papers[0]}` : ''}` })).sort((a, b) => a.accession.localeCompare(b.accession))
  const studyOf: Record<string, string> = {}
  for (const r of live) { const p = r.papers[0]; if (p && labelOf.has(p)) studyOf[r.accession] = labelOf.get(p)! }
  const blocked: string[] = []
  const proposed = live.filter((r) => r.proposed).length
  if (!include.length) blocked.push('The Study has no ingroup records')
  if (proposed) blocked.push(`${proposed} proposed outgroups need confirming or omitting`)
  return { include, outgroups, studyOf, stateHash: studyStateHash(s), blocked }
}

/** Identifies what a run depends on. Autosave, notes and the log don't change it. */
export function studyStateHash(s: Study): string {
  const records = Object.values(s.records).map(({ accession, column, proposed, omitted, papers }) => ({ accession, column, proposed: Boolean(proposed), omitted: omitted?.reason ?? null, papers: [...papers].sort() })).sort((a, b) => a.accession.localeCompare(b.accession))
  return `sha256:${sha256Hex(canonicalJson({ papers: s.papers.map((p) => p.id).sort(), records }))}`
}

/** Records a run, so nobody can present the third attempt as the only one. Omissions after this are labeled post hoc. */
export function recordRun(s: Study, run: StudyRun): Study {
  return logged({ ...s, runs: [...s.runs, run] }, { at: run.at, action: 'run-recorded', item: run.id, detail: run.stateHash })
}

export function parseStudy(text: string): Study {
  let v: any
  try { v = JSON.parse(text) } catch { throw new Error('This Study file is not valid JSON') }
  if (v?.schemaVersion !== 1) throw new Error(`This Study uses schema version ${String(v?.schemaVersion)}, which this version can't read`)
  if (typeof v.id !== 'string' || !Array.isArray(v.papers) || typeof v.records !== 'object' || !Array.isArray(v.log)) throw new Error('This file is not a Study')
  return v as Study
}

/** A methods section: the searches, inclusions, omissions and citations, with nothing left out. */
export function studyMethods(s: Study): string {
  const live = Object.values(s.records).filter((r) => !r.omitted)
  const omitted = Object.values(s.records).filter((r) => r.omitted)
  const out = [`# ${s.title}`, '', '## Searches', '']
  for (const q of s.searches) out.push(`- ${q.at}: "${q.query}" in ${q.sources.join(', ')}. ${Object.entries(q.counts).map(([k, n]) => `${k}: ${n}`).join(', ')}.${q.failed?.length ? ` Failed: ${q.failed.join(', ')}.` : ''}`)
  if (!s.searches.length) out.push('- None logged.')
  out.push('', '## Papers', '')
  for (const p of s.papers) {
    const n = live.filter((r) => r.papers.includes(p.id)).length
    out.push(`- **${p.label}.** ${[p.authors, p.title, p.journal, p.year].filter(Boolean).join('. ')}${p.doi ? `. doi:${p.doi}` : ''}. ${n} records used.${p.notices?.length ? ` Notices: ${p.notices.join(', ')}.` : ''}`)
  }
  out.push('', '## Records', '', `Ingroup ${live.filter((r) => r.column === 'ingroup').length}, outgroup ${live.filter((r) => r.column === 'outgroup').length}, omitted ${omitted.length}.`, '', '## Omissions', '')
  for (const r of omitted) out.push(`- ${r.accession}, ${r.omitted!.timing === 'after-result' ? 'post hoc, after a result was seen' : 'before any result'}: ${r.omitted!.reason}`)
  if (!omitted.length) out.push('- None.')
  out.push('', '## Runs', '')
  for (const r of s.runs) out.push(`- ${r.id}, ${r.at}, state ${r.stateHash}`)
  if (!s.runs.length) out.push('- None.')
  return `${out.join('\n')}\n`
}
