import { describe, expect, it } from 'vitest'
import { addPaperRecords, confirmOutgroup, coverageTrack, dropOn, moveLeft, moveRight, newStudy, omit, parseStudy, recordRun, restoreOmitted, studyMethods, studyStateHash, studyUse, type LinkedRecord, type Study, type StudyPaper } from '../src/index.js'

const at = '2026-11-05T00:00:00Z'
const opts = { at }
const rec = (accession: string, x: Partial<LinkedRecord> = {}): LinkedRecord => ({ accession, inTarget: true, hasMarker: true, ...x })
const paper = (id: string, linked: LinkedRecord[]): StudyPaper => ({ id, label: id.toUpperCase(), colorIndex: 0, title: `Title ${id}`, sources: ['pubmed'], linked, linkLookup: 'done' })
const moved = (r: ReturnType<typeof moveRight>): Study => { expect(r.outcome).toBe('moved'); return r.study }
const withPaper = (...ps: StudyPaper[]) => {
  let s = newStudy('s', 'S', at)
  for (const p of ps) s = addPaperRecords(moved(moveRight(s, { kind: 'result', paper: p }, opts)), p.id, at)
  return s
}
const a = paper('a', [rec('A1'), rec('A2'), rec('X1', { inTarget: false }), rec('G1', { hasMarker: false })])

describe('moving things', () => {
  it('moves a search result into the Study without its records, then its records with +', () => {
    const s = moved(moveRight(newStudy('s', 'S', at), { kind: 'result', paper: a }, opts))
    expect(s.papers.map((p) => p.id)).toEqual(['a'])
    expect(Object.keys(s.records)).toEqual([])
    const t = moved(moveRight(s, { kind: 'paper', id: 'a' }, opts))
    expect(t.records.A1?.column).toBe('ingroup')
  })
  it('proposes other species as outgroups and leaves other genes out without calling them omissions', () => {
    const s = withPaper(a)
    expect(s.records.X1).toMatchObject({ column: 'outgroup', proposed: true })
    expect(s.records.G1).toBeUndefined()
    expect(Object.values(s.records).filter((r) => r.omitted)).toEqual([])
  })
  it('moves records between ingroup and outgroup and logs it', () => {
    let s = moved(moveRight(withPaper(a), { kind: 'record', accession: 'A1' }, opts))
    expect(s.records.A1?.column).toBe('outgroup')
    s = moved(moveLeft(s, { kind: 'record', accession: 'A1' }, opts))
    expect(s.records.A1?.column).toBe('ingroup')
    expect(s.log.map((e) => e.action)).toEqual(expect.arrayContaining(['moved-to-outgroup', 'moved-to-ingroup']))
    expect(moveRight(moved(moveRight(s, { kind: 'record', accession: 'A1' }, opts)), { kind: 'record', accession: 'A1' }, opts).outcome).toBe('no-move')
  })
  it('asks for a reason before omitting, and keeps the record visible', () => {
    const s = withPaper(a)
    expect(moveLeft(s, { kind: 'record', accession: 'A1' }, opts).outcome).toBe('needs-reason')
    expect(moveLeft(s, { kind: 'record', accession: 'A1' }, { at, reason: '   ' }).outcome).toBe('needs-reason')
    const t = moved(moveLeft(s, { kind: 'record', accession: 'A1' }, { at, reason: 'Chimera in the paper' }))
    expect(t.records.A1?.omitted).toMatchObject({ reason: 'Chimera in the paper', timing: 'before-result' })
    expect(restoreOmitted(t, 'A1', at).records.A1?.omitted).toBeUndefined()
    expect(restoreOmitted(t, 'A1', at).log.at(-1)?.detail).toContain('Chimera')
  })
  it('asks before removing a paper, and keeps records another paper cites', () => {
    const s = withPaper(a, paper('b', [rec('A1'), rec('B1')]))
    expect(s.records.A1?.papers).toEqual(['a', 'b'])
    expect(moveLeft(s, { kind: 'paper', id: 'a' }, opts).outcome).toBe('needs-confirmation')
    const t = moved(moveLeft(s, { kind: 'paper', id: 'a' }, { at, confirmed: true }))
    expect(t.records.A1?.papers).toEqual(['b'])
    expect(t.records.A2).toBeUndefined()
    expect(t.papers.map((p) => p.id)).toEqual(['b'])
  })
  it('removes a hand-added record outright, since no paper needs it', () => {
    const s = withPaper(a)
    s.records.H1 = { ...rec('H1'), papers: [], column: 'ingroup' }
    expect(moved(moveLeft(s, { kind: 'record', accession: 'H1' }, opts)).records.H1).toBeUndefined()
  })
})

describe('dragging follows the same rules as the buttons', () => {
  it('agrees with + and −', () => {
    const s = withPaper(a)
    expect(moved(dropOn(s, { kind: 'record', accession: 'A1' }, 'outgroup', opts)).records.A1?.column).toBe('outgroup')
    expect(moved(dropOn(s, { kind: 'record', accession: 'X1' }, 'ingroup', opts)).records.X1?.column).toBe('ingroup')
    expect(dropOn(s, { kind: 'record', accession: 'A1' }, 'papers', opts).outcome).toBe('needs-reason')
    expect(dropOn(s, { kind: 'paper', id: 'a' }, 'results', opts).outcome).toBe('needs-confirmation')
    expect(dropOn(s, { kind: 'record', accession: 'A1' }, 'ingroup', opts).outcome).toBe('no-move')
    expect(dropOn(s, { kind: 'record', accession: 'A1' }, 'results', opts).outcome).toBe('no-move')
    expect(dropOn(s, { kind: 'paper', id: 'a' }, 'outgroup', opts).outcome).toBe('no-move')
  })
  it('adds a dragged result and its records when dropped on Ingroup', () => {
    const s = moved(dropOn(newStudy('s', 'S', at), { kind: 'result', paper: a }, 'ingroup', opts))
    expect(s.papers).toHaveLength(1)
    expect(s.records.A1?.column).toBe('ingroup')
  })
})

describe('integrity', () => {
  it('labels an omission post hoc once a run exists', () => {
    const s = recordRun(withPaper(a), { id: 'r1', at, stateHash: 'x' })
    const t = omit(s, 'A1', { at, reason: 'Looks odd' })
    expect(t.study.records.A1?.omitted?.timing).toBe('after-result')
    expect(studyMethods(t.study)).toContain('post hoc')
  })
  it('refuses a run with unconfirmed outgroups', () => {
    const s = withPaper(a)
    expect(studyUse(s).blocked).toEqual(['1 proposed outgroups need confirming or omitting'])
    const u = studyUse(confirmOutgroup(s, 'X1', at))
    expect(u.blocked).toEqual([])
    expect(u.include).toEqual(['A1', 'A2'])
    expect(u.outgroups.map((o) => o.accession)).toEqual(['X1'])
    expect(u.studyOf.A1).toBe('A')
  })
  it('keeps an omitted record out of a run', () => {
    const s = moved(moveLeft(withPaper(a), { kind: 'record', accession: 'A1' }, { at, reason: 'r' }))
    expect(studyUse(s).include).toEqual(['A2'])
  })
  it('changes the state hash when what a run uses changes, and not otherwise', () => {
    const s = withPaper(a)
    const h = studyStateHash(s)
    expect(studyStateHash({ ...s, autosave: false, log: [] })).toBe(h)
    expect(studyStateHash(moved(moveRight(s, { kind: 'record', accession: 'A1' }, opts)))).not.toBe(h)
    expect(studyStateHash(omit(s, 'A1', { at, reason: 'r' }).study)).not.toBe(h)
  })
  it('counts a shared record once in depth, and finds columns every paper covers', () => {
    const s = withPaper(paper('a', [rec('A1', { span: [0, 4] }), rec('S', { span: [2, 6] })]), paper('b', [rec('S', { span: [2, 6] }), rec('N')]))
    const t = coverageTrack(s, ['a', 'b'], 8)
    expect(t.depth).toEqual([1, 1, 2, 2, 1, 1, 0, 0])
    expect(t.shared).toEqual([false, false, true, true, true, true, false, false])
    expect(t.bands[1]).toMatchObject({ records: 2, unplaced: 1 })
    expect(coverageTrack(s, [], 2).shared).toEqual([false, false])
  })
  it('reads back what it wrote and rejects anything else', () => {
    const s = withPaper(a)
    expect(parseStudy(JSON.stringify(s))).toEqual(s)
    expect(() => parseStudy('{"schemaVersion":2}')).toThrow('schema version')
    expect(() => parseStudy('nope')).toThrow('not valid JSON')
  })
})
