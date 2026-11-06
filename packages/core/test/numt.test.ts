import { describe, expect, it } from 'vitest'
import { checkNumts } from '../src/index.js'

const ref = 'ACGT'.repeat(60)
const change = (s: string, at: number[]) => [...s].map((c, i) => (at.includes(i) ? (c === 'A' ? 'C' : 'A') : c)).join('')
const every = (n: number) => Array.from({ length: Math.floor(240 / n) }, (_, i) => i * n)

describe('checking a sequence against nuclear copies', () => {
  const copy = { id: 'copy1', aligned: change(ref, every(10)) }
  it('flags a sequence closer to the copy than to the reference', () => {
    const out = checkNumts(copy.aligned, [copy], ref)
    expect(out.tested).toBe(1)
    expect(out.flagged[0]).toMatchObject({ copy: 'copy1', shared: 240, toCopy: 0 })
    expect(out.flagged[0]!.toReference).toBeCloseTo(0.1, 5)
  })
  it('passes a sequence closer to the reference, or equally far', () => {
    expect(checkNumts(ref, [copy], ref).flagged).toEqual([])
    expect(checkNumts(change(ref, [3]), [{ id: 'same', aligned: ref }], ref).flagged).toEqual([])
  })
  it("doesn't test a copy sharing too few columns", () => {
    const short = { id: 'short', aligned: `${copy.aligned.slice(0, 80)}${'-'.repeat(160)}` }
    expect(checkNumts(copy.aligned, [short], ref)).toEqual({ tested: 0, flagged: [] })
  })
  it('compares only columns the copy covers', () => {
    const half = { id: 'half', aligned: `${ref.slice(0, 120)}${'-'.repeat(120)}` }
    // Far from the reference outside the copy, and identical inside it: no closer to one than the other.
    expect(checkNumts(`${ref.slice(0, 120)}${change(ref, every(2)).slice(120)}`, [half], ref).flagged).toEqual([])
  })
  it('skips gaps and ambiguous bases', () => {
    const q = `${'N'.repeat(120)}${ref.slice(120)}`
    expect(checkNumts(q, [copy], ref)).toMatchObject({ tested: 1, flagged: [] })
    expect(checkNumts('-'.repeat(240), [copy], ref).tested).toBe(0)
  })
})
