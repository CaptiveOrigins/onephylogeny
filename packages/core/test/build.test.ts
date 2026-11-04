import { describe, expect, it } from 'vitest'
import { alignToReference, assessAlignment, DEFAULT_GATES, buildPanel, evaluateQuery, leaveOneBlockOut, leaveOneGroupOut, reverseComplement, validatePanel, validateResult, type BuildPanelInput, type PanelSettings } from '../src/index.js'

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
  notCovered: ['Elsewhere'], validatedScope: [], thresholds: { minOverlap: 50, tolerance: 1, minDiagnosticConflicts: 2 },
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
  it('builds a valid sealed panel with real windows', () => {
    expect(validatePanel(bundle.panel).filter((d) => d.severity === 'error')).toEqual([])
    expect(bundle.panel.groups.find((g) => g.id === 'c')!.windows.map((w) => [w.start, w.end])).toEqual([[0, 100]])
  })
  it('finds sites fixed against all other groups', () => {
    const sites = bundle.panel.groups.find((g) => g.id === 'a')!.windows[0]!.diagnosticSites.map((s) => s.position)
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
    expect(Object.values(s)).toContain('novel_or_unsampled_flag')
    expect(Object.values(s)).not.toContain('consistent')
  })
  it('names the closest group by rate, so short windows are not favored', () => {
    const short = buildPanel({ ...input, members: [...input.members.filter((m) => m.group !== 'c'), { record: 'c1', group: 'c', aligned: blank(seqOf([5, 6, 7, 8, 9, 11]), 0, 100), provenanceClass: 'wild-documented' }] })
    const far = [...Array(40).keys()].map((i) => 100 + i * 12)
    const r = evaluateQuery(seqOf([5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, ...far]), short, options)
    const flagged = r.findings.find((f) => f.status === 'novel_or_unsampled_flag')!
    const rates = r.findings.filter((f) => f.distance !== undefined).map((f) => f.distance!)
    expect(flagged.distance).toBe(Math.min(...rates))
  })
  it('produces results that pass validation, carrying coverage caveats', () => {
    const r = evaluateQuery(seqOf(siteA), bundle, options)
    expect(validateResult(r, bundle.panel)).toEqual([])
    expect(r.caveats.join(' ')).toContain('Elsewhere')
  })
})

describe('validation harness', () => {
  it('leave-one-block-out never tests a record against its own block', () => {
    const members = input.members.map((m) => ({ ...m, block: m.group === 'a' ? 'same-site' : `s-${m.record}` }))
    const report = leaveOneBlockOut({ ...input, members })
    expect(report.groups.find((g) => g.group === 'a')).toBeUndefined()
    expect(report.skipped).toBeGreaterThan(0)
  })
  it('leave-one-group-out counts false claims', () => {
    const report = leaveOneGroupOut({ ...input, members: input.members })
    expect(report.scheme).toBe('leave-one-group-out')
    expect(report.tested).toBe(5)
    expect(report.falseConsistent).toBe(0)
  })
})

describe('gates', () => {
  it('rejects unrelated sequence and short matches', () => {
    expect(assessAlignment(alignToReference(randomSeq(500, 555), ref), DEFAULT_GATES).map((d) => d.code)).toContain('no-reference-match')
    expect(assessAlignment(alignToReference(ref.slice(0, 60), ref), DEFAULT_GATES).map((d) => d.code)).toContain('too-few-aligned-columns')
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
