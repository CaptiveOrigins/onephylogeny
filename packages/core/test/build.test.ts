import { describe, expect, it } from 'vitest'
import { alignToReference, assessAlignment, DEFAULT_GATES, buildPanel, evaluateQuery, gatesForRecord, leaveOneBlockOut, leaveOneGroupOut, reverseComplement, sealPanel, validatePanel, validateResult, verifyBundle, type BuildPanelInput, type PanelSettings } from '../src/index.js'

function randomSeq(n: number, seed = 7): string {
  // mulberry32: a short linear generator repeats itself, which makes "unrelated" sequences share long runs.
  let a = seed >>> 0
  let out = ''
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out += 'ACGT'[((t ^ (t >>> 14)) >>> 0) % 4]
  }
  return out
}
const ref = randomSeq(600)
const mutate = (s: string, at: number[]) => [...s].map((c, i) => (at.includes(i) ? (c === 'A' ? 'C' : 'A') : c)).join('')

describe('alignToReference', () => {
  it('places a fragment at its reference position', () => {
    const a = alignToReference(ref.slice(100, 300), ref)!
    expect(a.aligned).toHaveLength(600)
    expect(a.aligned.slice(100, 300)).toBe(ref.slice(100, 300))
    expect(a.aligned.slice(0, 100)).toBe('-'.repeat(100))
    expect(a.identity).toBe(1)
  })
  it('keeps real substitutions', () => {
    const a = alignToReference(mutate(ref.slice(50, 400), [100, 200]), ref)!
    expect(a.mismatches).toBe(2)
  })
  it('finds the reverse strand', () => {
    const a = alignToReference(reverseComplement(ref.slice(0, 300)), ref)!
    expect(a.orientation).toBe('reverse')
    expect(a.aligned.slice(0, 300)).toBe(ref.slice(0, 300))
  })
  it('reports insertions and deletions, and keeps reference length', () => {
    const ins = alignToReference(ref.slice(0, 200) + 'GGG' + ref.slice(200, 400), ref)!
    expect(ins.aligned).toHaveLength(600)
    expect(ins.insertions.reduce((s, x) => s + x.length, 0)).toBe(3)
    const del = alignToReference(ref.slice(0, 200) + ref.slice(203, 400), ref)!
    expect(del.deletions.reduce((s, x) => s + x.length, 0)).toBe(3)
    expect(del.mismatches).toBe(0)
  })
  it('keeps a real difference near the end of a sequence', () => {
    const q = ref.slice(100, 400)
    const changed = `${q.slice(0, 298)}${q[298] === 'A' ? 'C' : 'A'}${q.slice(299)}`
    const a = alignToReference(changed, ref)!
    expect(a.aligned.slice(100, 400)).toBe(changed)
    expect(a.mismatches).toBe(1)
    expect(a.placedEnds.end).toBeGreaterThan(0)
    const start = `${q[0] === 'A' ? 'C' : 'A'}${q.slice(1)}`
    expect(alignToReference(start, ref)!.aligned.slice(100, 400)).toBe(start)
  })
  it('does not invent paired insertions and deletions for nearby differences', () => {
    const a = alignToReference(mutate(ref.slice(0, 500), [200, 201, 203]), ref)!
    expect(a.insertions).toEqual([])
    expect(a.deletions).toEqual([])
    expect(a.mismatches).toBe(3)
  })
  it('clips junk flanks instead of forcing them in', () => {
    const a = alignToReference(randomSeq(40, 99) + ref.slice(100, 400) + randomSeq(40, 123), ref)!
    expect(a.aligned.slice(100, 400)).toBe(ref.slice(100, 400))
    expect(a.clipped.start + a.clipped.end).toBeGreaterThan(50)
  })
  it('returns null for an unrelated sequence', () => {
    expect(alignToReference(randomSeq(500, 555), ref)).toBeNull()
  })
  it('is not changed by surrounding gaps in the input', () => {
    expect(alignToReference(`--${ref.slice(0, 200)}--`, ref)!.aligned).toBe(alignToReference(ref.slice(0, 200), ref)!.aligned)
  })
})

const siteA = [10, 200, 450]
const siteB = [20, 210, 460]
const seqOf = (at: number[]) => mutate(ref, at)
const settings: PanelSettings = {
  id: 'p', version: '1', groups: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
  notCovered: ['Elsewhere'], validatedScope: [], rules: { minSharedColumns: 50, minDepthPerColumn: 1, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 },
}
const blank = (s: string, from: number, to: number) => [...s].map((c, i) => (i >= from && i < to ? c : '-')).join('')
const input: BuildPanelInput = {
  settings, taxa: [{ source: 't', id: '1' }], marker: { kind: 'gene', gene: 'g' }, reference: { accession: 'R.1', length: 600 }, sources: [], builtBy: 'run',
  members: [
    { record: 'a1', group: 'a', aligned: seqOf(siteA), provenanceClass: 'wild-documented' },
    { record: 'a2', group: 'a', aligned: seqOf([...siteA, 300]), provenanceClass: 'wild-documented' },
    { record: 'b1', group: 'b', aligned: seqOf(siteB), provenanceClass: 'seized' },
    { record: 'b2', group: 'b', aligned: seqOf([...siteB, 310]), provenanceClass: 'wild-documented' },
    { record: 'c1', group: 'c', aligned: blank(seqOf([5, 6, 7]), 0, 100), provenanceClass: 'wild-documented' },
  ],
}

describe('panels from members', () => {
  const bundle = buildPanel(input)
  it('builds a valid sealed panel with real coverage', () => {
    expect(validatePanel(bundle.panel).filter((d) => d.severity === 'error')).toEqual([])
    expect(bundle.panel.groups.find((g) => g.id === 'c')!.coverage[0]!.columnsAtDepth).toEqual([[0, 100]])
  })
  it('finds sites that separate each pair', () => {
    const sites = bundle.panel.pairs.find((p) => p.a === 'a' && p.b === 'b')!.sites.map((s) => s.position)
    expect(sites).toEqual(expect.arrayContaining(siteA))
  })
  it('never lets a seized record count as location evidence', () => {
    expect(bundle.panel.groups.find((g) => g.id === 'b')!.evidence.find((e) => e.record === 'b1')!.use).toBe('lineage-only')
  })
})

describe('evaluateQuery', () => {
  const bundle = buildPanel(input)
  const options = { queryId: 'q', runId: 'r' }
  const status = (seq: string) => Object.fromEntries(evaluateQuery(seq, bundle, options).findings.map((f) => [f.group, f.status]))
  it('calls the right group consistent and excludes the other', () => {
    const s = status(seqOf(siteA))
    expect(s.a).toBe('consistent')
    expect(s.b).toBe('excluded_within_panel')
  })
  it('says not evaluable when a query shares no sites', () => {
    const s = status(blank(seqOf(siteA), 300, 600))
    expect(s.c).toBe('not_evaluable')
    expect(s.a).toBe('consistent')
  })
  it('flags a query unlike any group', () => {
    const s = status(seqOf([1, 2, 3, 40, 50, 60, 70, 80, 90, 120, 130, 140]))
    expect(Object.values(s)).not.toContain('consistent')
    expect(evaluateQuery(seqOf([1, 2, 3, 40, 50, 60, 70, 80, 90, 120, 130, 140]), bundle, options).novelty.flagged).toBe(true)
  })
  it('names the closest group by rate, so short windows are not favored', () => {
    const short = buildPanel({ ...input, members: [...input.members.filter((m) => m.group !== 'c'), { record: 'c1', group: 'c', aligned: blank(seqOf([5, 6, 7, 8, 9, 11]), 0, 100), provenanceClass: 'wild-documented' }] })
    const far = [...Array(40).keys()].map((i) => 100 + i * 12)
    const r = evaluateQuery(seqOf([5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, ...far]), short, options)
    const closest = r.findings.find((f) => f.group === r.novelty.closest)!
    const rates = r.findings.filter((f) => f.distance !== undefined).map((f) => f.distance!)
    expect(closest.distance).toBe(Math.min(...rates))
  })
  it('produces results that pass validation, carrying coverage caveats', () => {
    const r = evaluateQuery(seqOf(siteA), bundle, options)
    expect(validateResult(r, bundle.panel)).toEqual([])
    expect(r.caveats.join(' ')).toContain('Elsewhere')
  })
})

describe('records assigned by their own sequence', () => {
  const R = randomSeq(200, 11)
  const at = (...sites: number[]) => mutate(R, sites)
  const settings = { id: 'p', version: '1', groups: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], notCovered: ['Z'], validatedScope: [], rules: { minSharedColumns: 20, minDepthPerColumn: 1, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 0 } }
  const base = { settings, taxa: [{ source: 't', id: '1' }], marker: { kind: 'gene' as const, gene: 'g' }, reference: { accession: 'R.1', length: 200 }, sources: [], builtBy: 'test' }
  const wild = [
    { record: 'x1', group: 'x', aligned: at(10, 20, 30, 40), provenanceClass: 'origin-reported' as const, originSource: 's' },
    { record: 'x2', group: 'x', aligned: at(10, 20, 30, 40, 50), provenanceClass: 'origin-reported' as const, originSource: 's' },
    { record: 'y1', group: 'y', aligned: at(60, 70, 80, 90), provenanceClass: 'origin-reported' as const, originSource: 's' },
  ]
  // Carries Y's states, but was labelled X by its sequence: it mustn't erase what separates the two.
  const seized = { record: 's1', group: 'x', aligned: at(60, 70, 80, 90, 95), provenanceClass: 'seized' as const }
  const query = at(60, 70, 80, 90)
  const options = { queryId: 'q', runId: 'r' }

  it("can't erase a fixed site or turn an exclusion into consistent", () => {
    const clean = buildPanel({ ...base, members: wild })
    const withSeized = buildPanel({ ...base, members: [...wild, seized] })
    const sites = (b: typeof clean) => b.panel.pairs.flatMap((p) => p.sites)
    expect(sites(withSeized)).toEqual(sites(clean))
    const status = (b: typeof clean) => evaluateQuery(query, b, options).findings.find((f) => f.group === 'x')!
    expect(status(clean).status).toBe('excluded_within_panel')
    expect(status(withSeized).status).toBe('excluded_within_panel')
    expect(status(withSeized).evidence).not.toContain('s1')
  })
  it('stays listed, marked, and sealed', () => {
    const b = buildPanel({ ...base, members: [...wild, seized] })
    expect(b.panel.groups[0]!.evidence.find((e) => e.record === 's1')).toMatchObject({ use: 'lineage-only', provenanceClass: 'seized' })
    expect(b.sequences.s1).toBeDefined()
    expect(verifyBundle(b)).toEqual([])
  })
  it('leaves a group with nothing else not evaluable, with a reason', () => {
    const b = buildPanel({ ...base, members: [wild[2]!, seized] })
    const x = evaluateQuery(query, b, options).findings.find((f) => f.group === 'x')!
    expect(x.status).toBe('not_evaluable')
    expect(x.reason).toMatch(/no record that can show/)
    expect(validatePanel(b.panel).map((d) => d.code)).toContain('no-location-evidence')
  })
  it('is never scored as test truth', () => {
    const report = leaveOneBlockOut({ ...base, members: [...wild, { ...seized, block: 'site-s' }].map((m, i) => ({ block: `site-${i}`, ...m })) })
    // x1 and x2 are tested. y1 is skipped, because holding it out leaves Y with nothing. s1 is neither.
    expect(report.tested).toBe(2)
    expect(report.skipped).toBe(1)
    expect(report.diagnostics.map((d) => d.code)).toContain('lineage-only-not-tested')
  })
  it('seals the sequences, so editing one breaks the seal', () => {
    const b = buildPanel({ ...base, members: wild, referenceSequence: R })
    expect(verifyBundle({ ...b, sequences: { ...b.sequences, x1: at(10) } }).map((d) => d.code)).toEqual(['sequences-changed'])
    expect(verifyBundle({ ...b, referenceSequence: at(1) }).map((d) => d.code)).toEqual(['sequences-changed'])
    expect(verifyBundle({ ...b, panel: { ...b.panel, notCovered: [] } }).map((d) => d.code)).toEqual(['checksum-mismatch'])
  })
})

describe('evaluator version 2', () => {
  const R = randomSeq(900, 21)
  const at = (...sites: number[]) => mutate(R, sites)
  const windows = [{ id: 'front', label: 'Front', start: 0, end: 450 }, { id: 'back', label: 'Back', start: 450, end: 900 }]
  const rules = { minSharedColumns: 100, minDepthPerColumn: 5, minBlocksForExclusion: 3, minDecisiveSites: 2, tolerance: 1 }
  const a = [10, 200, 500, 700]
  const b = [20, 210, 510, 710]
  const base = (groups: string[]) => ({
    settings: { id: 'p', version: '1', groups: groups.map((id) => ({ id, label: id.toUpperCase() })), notCovered: ['Z'], validatedScope: [], windows, rules },
    taxa: [{ source: 't', id: '1' }], marker: { kind: 'gene' as const, gene: 'g' }, reference: { accession: 'R.1', length: 900 }, sources: [], builtBy: 'test',
  })
  const member = (record: string, group: string, aligned: string, block: string) => ({ record, group, aligned, provenanceClass: 'wild-documented' as const, block })
  const many = (group: string, sites: number[], blocks = 3, n = 6) => Array.from({ length: n }, (_, i) => member(`${group}${i}`, group, at(...sites, 300 + i * 17), `${group}-site-${i % blocks}`))
  const options = { queryId: 'q', runId: 'r' }
  const members = [...many('a', a), ...many('b', b)]
  const bundle = buildPanel({ ...base(['a', 'b']), members })
  const pair = (r: ReturnType<typeof evaluateQuery>, x: string, y: string) => r.pairs.find((p) => p.a === x && p.b === y)!
  const finding = (r: ReturnType<typeof evaluateQuery>, g: string) => r.findings.find((f) => f.group === g)!
  const blank2 = (s: string, from: number, to: number) => [...s].map((c, i) => (i >= from && i < to ? c : '-')).join('')

  it("doesn't let a third group erase what separates two others", () => {
    const c = member('c0', 'c', at(...a.slice(0, 2), ...b.slice(0, 2)), 'c-site')
    const withC = buildPanel({ ...base(['a', 'b', 'c']), settings: { ...base(['a', 'b', 'c']).settings, rules: { ...rules, minDepthPerColumn: 1 } }, members: [...members, c] })
    const without = buildPanel({ ...base(['a', 'b']), settings: { ...base(['a', 'b']).settings, rules: { ...rules, minDepthPerColumn: 1 } }, members })
    expect(withC.panel.pairs.filter((p) => p.a === 'a' && p.b === 'b')).toEqual(without.panel.pairs)
  })
  it('gives a fragment with no decisive site not_resolved, even when both groups are consistent', () => {
    const fragment = blank2(at(...a), 230, 480)
    const r = evaluateQuery(fragment, bundle, options)
    expect(pair(r, 'a', 'b')).toMatchObject({ state: 'not_resolved', reasonCode: 'no-sites-covered', sitesCovered: 0 })
    expect(finding(r, 'a').status).toBe('consistent')
    expect(finding(r, 'b').status).toBe('consistent')
    expect(finding(r, 'a').informativeSites).toBe(0)
  })
  it('resolves a pair from decisive sites and rules out the other group', () => {
    const r = evaluateQuery(at(...a), bundle, options)
    expect(pair(r, 'a', 'b')).toMatchObject({ state: 'resolved', favors: 'a', forA: 8, forB: 0 })
    expect(finding(r, 'a').status).toBe('consistent')
    expect(finding(r, 'b').status).toBe('excluded_within_panel')
    expect(validateResult(r, bundle.panel)).toEqual([])
  })
  it("doesn't resolve a pair when sites disagree", () => {
    const r = evaluateQuery(at(a[0]!, a[1]!, b[2]!, b[3]!), bundle, options)
    expect(pair(r, 'a', 'b')).toMatchObject({ state: 'not_resolved', reasonCode: 'sites-disagree' })
  })
  it("doesn't let one record make a group comparable", () => {
    const b2 = buildPanel({ ...base(['a', 'b']), members: [...many('a', a), ...many('b', b, 3, 4)] })
    const r = evaluateQuery(at(...b), b2, options)
    expect(finding(r, 'b')).toMatchObject({ status: 'not_evaluable', reasonCode: 'too-few-records', recordsNeeded: 1 })
    expect(r.candidatesNotEvaluated).toEqual(['b'])
    expect(pair(r, 'a', 'b')).toMatchObject({ state: 'not_evaluable', reasonCode: 'group-not-evaluable' })
    expect(b2.panel.pairs.every((p) => p.state === 'not_evaluable')).toBe(true)
  })
  it("can't rule out a group from one sampling site", () => {
    const b2 = buildPanel({ ...base(['a', 'b']), members: [...many('a', a), ...many('b', b, 1)] })
    const r = evaluateQuery(at(...a), b2, options)
    expect(pair(r, 'a', 'b')).toMatchObject({ state: 'not_resolved', reasonCode: 'thin-group' })
    expect(finding(r, 'b').status).toBe('inconclusive')
    expect(finding(r, 'b').reasonCode).toBe('outside-spread-not-contradicted')
    // The well-sampled side can still be ruled out by the thin side's states.
    const other = evaluateQuery(at(...b), b2, options)
    expect(pair(other, 'a', 'b')).toMatchObject({ state: 'resolved', favors: 'b' })
  })
  it('counts records without a site as one block, so missing data looks like nothing', () => {
    const noSites = [...many('a', a), ...many('b', b).map(({ block: _block, ...m }) => m)]
    const b2 = buildPanel({ ...base(['a', 'b']), members: noSites })
    expect(b2.panel.groups.find((g) => g.id === 'b')!.coverage[0]!.blocks).toBe(1)
    expect(pair(evaluateQuery(at(...a), b2, options), 'a', 'b').reasonCode).toBe('thin-group')
  })
  it('lets a compatible ambiguity break a fixed site', () => {
    const ambiguous = [...many('a', a), ...many('b', b).map((m, i) => (i ? m : { ...m, aligned: m.aligned.slice(0, 10) + 'N' + m.aligned.slice(11) }))]
    const refBase = R[10]!
    const code = refBase === 'A' || refBase === 'C' ? 'M' : refBase === 'G' ? 'R' : 'W'
    const withCode = many('b', b).map((m, i) => (i ? m : { ...m, aligned: m.aligned.slice(0, 10) + code + m.aligned.slice(11) }))
    const site = (ms: typeof members) => buildPanel({ ...base(['a', 'b']), members: ms }).panel.pairs.find((p) => p.window === 'front')!.sites.map((s) => s.position)
    expect(site(ambiguous as typeof members)).toContain(10)
    expect(site([...many('a', a), ...withCode])).not.toContain(10)
  })
  it('leaves a group with no records in the query window not evaluable, whatever else is known', () => {
    const backOnly = many('a', a).map((m) => ({ ...m, aligned: blank2(m.aligned, 450, 900) }))
    const b2 = buildPanel({ ...base(['a', 'b']), members: [...backOnly, ...many('b', b)] })
    const r = evaluateQuery(blank2(at(...b), 0, 450), b2, options)
    expect(finding(r, 'a').status).toBe('not_evaluable')
    expect(b2.panel.pairs.find((p) => p.window === 'front')!.state).toBe('not_evaluable')
  })
  it('keeps novelty on the query and never overwrites a finding', () => {
    const far = [...Array(40).keys()].map((i) => 30 + i * 21)
    const r = evaluateQuery(at(...far), bundle, options)
    expect(r.novelty).toMatchObject({ flagged: true, reasons: expect.arrayContaining(['no-consistent-group']) })
    expect(r.novelty.closest).toBeDefined()
    for (const f of r.findings) expect(['consistent', 'excluded_within_panel', 'inconclusive', 'not_evaluable']).toContain(f.status)
  })
  it('counts a base matching neither side without flagging the query', () => {
    const third = R[10] === 'G' ? 'T' : 'G'
    const other = at(...a)
    const q = other.slice(0, 20) + (other[20] === third || at(...b)[20] === third ? 'T' : third) + other.slice(21)
    const r = evaluateQuery(q, bundle, options)
    expect(r.novelty.neitherSideSites).toBeGreaterThan(0)
    expect(r.novelty.flagged).toBe(false)
  })
  it('scales a group spread to the columns compared', () => {
    // Each record differs from its nearest groupmate at many columns, so the spread is wide enough to scale.
    const wide = Array.from({ length: 6 }, (_, i) => member(`w${i}`, 'a', at(...a, ...Array.from({ length: 8 }, (_, k) => 230 + i * 30 + k)), `s${i % 3}`))
    const b2 = buildPanel({ ...base(['a', 'b']), members: [...wide, ...many('b', b)] })
    const full = finding(evaluateQuery(at(...a), b2, options), 'a').windows[0]!
    const short = finding(evaluateQuery(blank2(at(...a), 0, 150), b2, options), 'a').windows[0]!
    expect(short.sharedColumns).toBeLessThan(full.sharedColumns)
    expect(short.allowedDifferences).toBeLessThan(full.allowedDifferences)
  })
  it('says a candidate panel is outside validated scope', () => {
    expect(evaluateQuery(at(...a), bundle, options).outOfValidatedScope).toHaveLength(2)
  })
  it('hides site names, and refuses stored sites that its sequences do not support', () => {
    expect(JSON.stringify(bundle.panel)).not.toContain('a-site')
    expect(verifyBundle(bundle)).toEqual([])
    const forged = sealPanel({ ...bundle.panel, pairs: bundle.panel.pairs.map((p) => ({ ...p, sites: [] })) })
    expect(verifyBundle({ ...bundle, panel: forged }).map((d) => d.code)).toEqual(['derivation-mismatch'])
  })
  it('keeps the study on each record', () => {
    const b2 = buildPanel({ ...base(['a', 'b']), members: [{ ...many('a', a)[0]!, study: 'Paper A' }, ...many('a', a).slice(1), ...many('b', b)] })
    expect(b2.panel.groups[0]!.evidence[0]!.study).toBe('Paper A')
  })
  it('reports stricter counts when another group could not be compared', () => {
    const report = leaveOneBlockOut({ ...base(['a', 'b']), members: [...many('a', a, 3, 9), ...many('b', b, 3, 2)] })
    const s = report.groups.find((g) => g.group === 'a')!
    expect(s.onlyTruth).toBeGreaterThan(0)
    expect(s.onlyTruthAllEvaluated).toBe(0)
  })
})

describe('validation harness', () => {
  it('leave-one-block-out never tests a record against its own block', () => {
    const members = input.members.map((m) => ({ ...m, block: m.group === 'a' ? 'same-site' : `s-${m.record}` }))
    const report = leaveOneBlockOut({ ...input, members })
    expect(report.groups.find((g) => g.group === 'a')).toBeUndefined()
    expect(report.skipped).toBeGreaterThan(0)
    expect(report.untestedGroups).toContain('a')
  })
  it('every test is counted exactly once', () => {
    const report = leaveOneBlockOut({ ...input, members: input.members.map((m, i) => ({ ...m, block: `s${i}` })) })
    for (const g of report.groups) expect(g.includedTruth + g.excludedTruth + g.inconclusive + g.notEvaluable).toBe(g.tested)
  })
  it('warns when records have no site', () => {
    expect(leaveOneBlockOut({ ...input, members: input.members }).diagnostics.map((d) => d.code)).toContain('records-without-site')
  })
  it('leave-one-group-out counts false claims', () => {
    const report = leaveOneGroupOut({ ...input, members: input.members })
    expect(report.scheme).toBe('leave-one-group-out')
    // Five members, one of them seized: its label came from its own sequence, so it can't be test truth.
    expect(report.tested).toBe(4)
    expect(report.falseConsistent).toBe(0)
    expect(report.diagnostics.map((d) => d.code)).toContain('lineage-only-not-tested')
  })
  it('leave-one-group-out says when a record could not be compared at all', () => {
    const members = [input.members[0]!, { ...input.members[4]!, aligned: blank(seqOf([5, 6, 7]), 0, 30) }]
    const report = leaveOneGroupOut({ ...input, settings: { ...settings, groups: [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }] }, members })
    expect(report.diagnostics.map((d) => d.code)).toContain('not-evaluable-counted-separately')
  })
})

describe('gates', () => {
  it('rejects unrelated sequence and short matches', () => {
    expect(assessAlignment(alignToReference(randomSeq(500, 555), ref), DEFAULT_GATES).map((d) => d.code)).toContain('no-reference-match')
    expect(assessAlignment(alignToReference(ref.slice(0, 60), ref), DEFAULT_GATES).map((d) => d.code)).toContain('too-few-aligned-columns')
  })
  it('rejects a sequence that is mostly something else', () => {
    const joined = alignToReference(ref.slice(0, 150) + randomSeq(500, 321), ref)
    expect(assessAlignment(joined, DEFAULT_GATES).map((d) => d.code)).toContain('low-query-coverage')
    expect(assessAlignment(joined, { ...DEFAULT_GATES, minQueryCoverage: undefined }).map((d) => d.code)).toContain('terminal-discordance')
  })
  it('rejects a foreign tail too short to fail coverage', () => {
    const joined = alignToReference(ref.slice(0, 365) + randomSeq(65, 99), ref)
    expect(assessAlignment(joined, DEFAULT_GATES).filter((d) => d.severity === 'error').map((d) => d.code)).toEqual(['terminal-discordance'])
  })
  it('allows a real flank beyond the end of the reference', () => {
    const flanked = alignToReference(ref.slice(300) + randomSeq(65, 99), ref)
    const found = assessAlignment(flanked, DEFAULT_GATES)
    expect(found.filter((d) => d.severity === 'error')).toEqual([])
    expect(found.map((d) => d.code)).toContain('clipped-ends')
  })
  it('holds an unannotated record to the coverage check unless it is many times the reference', () => {
    const record = (length: number) => gatesForRecord(DEFAULT_GATES, { wholeRecord: true, length, referenceLength: 600 })
    const mostlyOther = alignToReference(ref.slice(0, 300) + randomSeq(700, 5), ref)
    expect(assessAlignment(mostlyOther, record(1000)).map((d) => d.code)).toContain('low-query-coverage')
    expect(record(1000).minQueryCoverage).toBe(DEFAULT_GATES.minQueryCoverage)
    expect(record(16000).minQueryCoverage).toBeUndefined()
    expect(record(16000).maxTerminalDiscordance).toBeUndefined()
    expect(gatesForRecord(DEFAULT_GATES, { wholeRecord: false, length: 16000, referenceLength: 600 })).toBe(DEFAULT_GATES)
  })
  it('makes frame problems errors only when asked', () => {
    const shifted = alignToReference(ref.slice(0, 200) + ref.slice(201, 400), ref)
    const severity = (frameErrors: boolean) => assessAlignment(shifted, { ...DEFAULT_GATES, frameErrors }).find((d) => d.code === 'frame-shifting-indel')?.severity
    expect(severity(false)).toBe('warning')
    expect(severity(true)).toBe('error')
  })
  it('warns about a frame-shifting deletion but passes a clean record', () => {
    expect(assessAlignment(alignToReference(ref.slice(0, 300), ref), DEFAULT_GATES)).toEqual([])
    const shifted = alignToReference(ref.slice(0, 200) + ref.slice(201, 400), ref)
    expect(assessAlignment(shifted, DEFAULT_GATES).map((d) => d.code)).toContain('frame-shifting-indel')
  })
  it('finds in-frame stops using reference coordinates', () => {
    const codons = 'GCT'.repeat(60)
    const withStop = `${codons.slice(0, 30)}TAA${codons.slice(33)}`
    const a = alignToReference(withStop, codons, { k: 3, minSeedHits: 1 })!
    const code = { minAlignedColumns: 1, minIdentity: 0, codonStart: 0, geneticCode: 2 as const }
    expect(assessAlignment({ ...a, aligned: withStop }, code).map((d) => d.code)).toContain('internal-stop')
  })
})
