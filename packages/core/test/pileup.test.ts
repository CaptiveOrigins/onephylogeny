import { describe, expect, it } from 'vitest'

import { consensusFromPileup, parseMpileup, PileupError } from '../src'

const q = (n: number, phred = 30) => String.fromCharCode(33 + phred).repeat(n)
const line = (pos: number, ref: string, bases: string, quals: string) => ['mt', pos, ref, bases.length, bases, quals].join('\t')

describe('parseMpileup', () => {
  it('counts matches on both strands, mismatches, deletions and insertions, and skips read starts and ends', () => {
    // Matches on both strands (. and ,), a G, an 'a' (an A on the reverse strand: the reference base, so it counts as
    // A), a deletion, an insertion after one match, one read start and one end.
    const bases = '^~..,$,.+2ACGa*'
    const { positions } = parseMpileup(line(5, 'a', bases, q(8)))
    expect(positions[0]).toEqual({ pos: 5, ref: 'A', counts: { A: 6, C: 0, G: 1, T: 0, deletion: 1 }, insertions: 1 })
  })

  it('drops bases below the quality cutoff', () => {
    const { positions } = parseMpileup(line(1, 'C', '....', q(2, 30) + q(2, 10)))
    expect(positions[0]!.counts.C).toBe(2)
  })

  it('refuses short rows, mismatched qualities and a second reference', () => {
    expect(() => parseMpileup('mt\t1\tA')).toThrow(PileupError)
    expect(() => parseMpileup(line(1, 'A', '...', q(2)))).toThrow(/3 bases but 2 qualities/)
    expect(() => parseMpileup([line(1, 'A', '.', q(1)), line(1, 'A', '.', q(1)).replace(/^mt/, 'other')].join('\n'))).toThrow(/More than one reference/)
  })
})

describe('consensusFromPileup', () => {
  const pos = (p: number, counts: Partial<Record<'A' | 'C' | 'G' | 'T' | 'deletion', number>>, insertions = 0) => ({ pos: p, ref: 'A', counts: { A: 0, C: 0, G: 0, T: 0, deletion: 0, ...counts }, insertions })

  it('writes confident bases, N for thin or split positions and for positions with no reads, and - for deletions', () => {
    const c = consensusFromPileup([pos(1, { A: 30 }), pos(2, { C: 5 }), pos(3, { G: 12, T: 10 }), pos(4, { deletion: 20 }), pos(6, { T: 18, C: 2 })], 6)
    expect(c.sequence).toBe('ANN-NT')
    expect(c).toMatchObject({ covered: 3, lowDepth: 2, ambiguous: 1, deleted: 1 })
  })

  it('lists mixed positions (a possible nuclear copy, mixed sample or heteroplasmy) without changing the call', () => {
    const c = consensusFromPileup([pos(1, { A: 170, G: 30 }), pos(2, { C: 100 })], 2)
    expect(c.sequence).toBe('AC')
    expect(c.mixed).toEqual([{ pos: 1, top: 'A', second: 'G', topShare: 0.85, secondShare: 0.15, depth: 200 }])
  })

  it('notes frequent insertions without adding them, and refuses positions outside the reference', () => {
    expect(consensusFromPileup([pos(1, { A: 20 }, 15)], 1).insertions).toEqual([1])
    expect(() => consensusFromPileup([pos(3, { A: 20 })], 2)).toThrow(/outside the reference/)
  })

  it('works end to end from mpileup text', () => {
    const text = [line(1, 'A', '.'.repeat(12), q(12)), line(2, 'C', 'T'.repeat(12), q(12))].join('\n')
    expect(consensusFromPileup(parseMpileup(text).positions, 3).sequence).toBe('ATN')
  })
})
