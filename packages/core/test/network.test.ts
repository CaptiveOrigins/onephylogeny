import { describe, expect, it } from 'vitest'
import { haplotypeNetwork, steps, type Panel, type PanelBundle } from '../src/index.js'

const ev = (record: string) => ({ record, use: 'lineage-and-location' as const, provenanceClass: 'wild-documented' as const })
const bundleOf = (groups: Record<string, Record<string, string>>): PanelBundle => ({
  panel: { windows: [{ id: 'w', label: 'W', start: 0, end: 6 }], groups: Object.entries(groups).map(([id, recs]) => ({ id, label: id, coverage: [], evidence: Object.keys(recs).map(ev) })) } as unknown as Panel,
  sequences: Object.assign({}, ...Object.values(groups)),
})

describe('haplotype network (roadmap stage 5)', () => {
  it('counts differing sites over unambiguous bases only', () => {
    expect(steps('ACGTAC', 'ACGTTT')).toBe(2)
    expect(steps('ACGNAC', 'ACGTAC')).toBe(0)
  })

  it('collapses identical haplotypes, counting records by group, and joins them by the fewest steps', () => {
    const n = haplotypeNetwork(bundleOf({ a: { a1: 'AAAAAA', a2: 'AAAAAA', a3: 'AAAAAC' }, b: { b1: 'AAAACC', b2: 'AAAAAA' } }), 'w')
    expect(n.nodes).toEqual([
      { id: 'h1', records: ['a1', 'a2', 'b2'], byGroup: { a: 2, b: 1 } },
      { id: 'h2', records: ['a3'], byGroup: { a: 1 } },
      { id: 'h3', records: ['b1'], byGroup: { b: 1 } },
    ])
    expect(n.edges).toEqual([{ a: 'h1', b: 'h2', steps: 1 }, { a: 'h2', b: 'h3', steps: 1 }])
  })

  it('keeps every equally short link instead of choosing one', () => {
    // A square: each corner is one step from two others, two steps from the opposite one.
    const n = haplotypeNetwork(bundleOf({ a: { p: 'AAAAAA', q: 'CAAAAA', r: 'ACAAAA', s: 'CCAAAA' } }), 'w')
    expect(n.edges).toHaveLength(4)
    expect(n.edges.every((e) => e.steps === 1)).toBe(true)
  })

  it('leaves out records that don\'t cover the window whole, and counts them', () => {
    const n = haplotypeNetwork(bundleOf({ a: { a1: 'AAAAAA', a2: 'AAA---' } }), 'w')
    expect([n.nodes.length, n.partial]).toEqual([1, 1])
    expect(() => haplotypeNetwork(bundleOf({ a: { a1: 'AAAAAA' } }), 'nope')).toThrow(/No window/)
  })
})
