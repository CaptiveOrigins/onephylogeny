import { describe, expect, it } from 'vitest'
import { auditGroups, chimeraCandidates, pDistance, type Panel, type PanelBundle } from '../src/index.js'

// Invented panel: one 10-column window; the audit reads groups, evidence, windows and sequences.
const ev = (record: string) => ({ record, use: 'lineage-and-location' as const, provenanceClass: 'wild-documented' as const })
const bundleOf = (groups: Record<string, Record<string, string>>): PanelBundle => ({
  panel: { windows: [{ id: 'w', label: 'W', start: 0, end: 10 }], groups: Object.entries(groups).map(([id, recs]) => ({ id, label: id, coverage: [], evidence: Object.keys(recs).map(ev) })) } as unknown as Panel,
  sequences: Object.assign({}, ...Object.values(groups)),
})

describe('group audit (roadmap stage 3)', () => {
  it('measures p-distance over unambiguous bases only', () => {
    expect(pDistance('ACGTACGTAC', 'ACGTACGTAA')).toBeCloseTo(0.1)
    expect(pDistance('ACGTNCGTAC', 'ACGTACGTAA')).toBeCloseTo(1 / 9)
    expect(pDistance('NNNN', 'ACGT')).toBe(0)
  })

  it('a clean panel raises nothing, and reports each group\'s spread', () => {
    const [w] = auditGroups(bundleOf({ a: { a1: 'AAAAAAAAAA', a2: 'AAAAAAAAAC' }, b: { b1: 'GGGGGGGGGG', b2: 'GGGGGGGGGT' } }))
    expect(w!.flags).toEqual([])
    expect(w!.groups).toEqual([{ group: 'a', records: 2, haplotypes: 2, maxWithin: 0.1 }, { group: 'b', records: 2, haplotypes: 2, maxWithin: 0.1 }])
  })

  it('flags a record closer to another group than to its own', () => {
    const [w] = auditGroups(bundleOf({ a: { a1: 'AAAAAAAAAA', a2: 'AAAAAAAAAC', a3: 'GGGGGGGGGA' }, b: { b1: 'GGGGGGGGGG', b2: 'GGGGGGGGGT' } }))
    expect(w!.flags).toEqual([{ kind: 'closer-to-other-group', record: 'a3', group: 'a', nearestOwn: 0.9, nearestOther: 0.1, otherGroup: 'b', otherRecord: 'b1' }])
  })

  it('flags a haplotype shared by two groups, and a group with one full-window record', () => {
    const [w] = auditGroups(bundleOf({ a: { a1: 'AAAAAAAAAA', a2: 'CCCCCCCCCC' }, b: { b1: 'AAAAAAAAAA', b2: 'AAAAAAAAAA' }, c: { c1: 'TTTTTTTTTT' } }))
    expect(w!.flags).toContainEqual({ kind: 'shared-haplotype', groups: ['a', 'b'], records: ['a1', 'b1', 'b2'] })
    expect(w!.flags).toContainEqual({ kind: 'single-record', group: 'c', record: 'c1' })
  })

  it('leaves out records that don\'t cover the whole window, so fragments can\'t pass for clusters', () => {
    const [w] = auditGroups(bundleOf({ a: { a1: 'AAAAAAAAAA', a2: 'AAAAA-----' }, b: { b1: 'GGGGGGGGGG', b2: '-----AAAAA' } }))
    expect(w!.partial).toBe(2)
    expect([w!.columns, w!.mostCovered]).toEqual([10, 10])
    expect(w!.groups.map((g) => g.records)).toEqual([1, 1])
    expect(w!.flags.filter((f) => f.kind === 'closer-to-other-group')).toEqual([])
  })
})

describe('chimera candidates (roadmap stage 4)', () => {
  const two = (groups: Record<string, Record<string, string>>): PanelBundle => {
    const b = bundleOf(groups)
    return { ...b, panel: { ...b.panel, windows: [{ id: 'left', label: 'L', start: 0, end: 5 }, { id: 'right', label: 'R', start: 5, end: 10 }] } as Panel }
  }
  it('flags a record whose two halves are nearest to different groups', () => {
    const r = chimeraCandidates(two({ a: { a1: 'AAAAAAAAAA', a2: 'AAAAAAAAAC', x: 'AAAAAGGGGG' }, b: { b1: 'GGGGGGGGGG', b2: 'GGGGGGGGGT' } }))
    expect(r.checked).toBe(5)
    expect(r.candidates).toEqual([{ record: 'x', group: 'a', windows: [{ window: 'left', nearestGroups: ['a'], distance: 0 }, { window: 'right', nearestGroups: ['b'], distance: 0 }] }])
  })
  it('passes consistent records, and skips records that don\'t cover two windows whole', () => {
    const r = chimeraCandidates(two({ a: { a1: 'AAAAAAAAAA', a2: 'AAAAA-----' }, b: { b1: 'GGGGGGGGGG', b2: 'GGGGGGGGGT' } }))
    expect(r).toEqual({ candidates: [], checked: 3 })
  })
})
