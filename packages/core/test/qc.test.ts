import { describe, expect, it } from 'vitest'
import { clusters, DEFAULT_QC, sampleQc } from '../src/index.js'

const ref = 'ACGTACGTAC'.repeat(10) // 100 columns
const at = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i + 1)
const status = (q: ReturnType<typeof sampleQc>, rule: string) => q.rules.find((r) => r.rule === rule)!.status

describe('sample QC (roadmap stage 4)', () => {
  it('a clean sequence is good on every rule, with the defaults named', () => {
    const q = sampleQc(ref, [], { p1: ref })
    expect(q.overall).toBe('good')
    expect(q.rules.map((r) => r.rule)).toEqual(['missing-data', 'mixed-sites', 'frame', 'stops', 'clustered-differences'])
    expect(q).toMatchObject({ settings: 'default', nearest: 'p1' })
  })

  it('grades missing data by share of covered columns, and mixed sites by count', () => {
    expect(status(sampleQc(at(ref, 5, 'N'), [], { p1: ref }), 'missing-data')).toBe('mediocre') // 1 of 100
    expect(status(sampleQc(ref.replace(/^A{0}ACGTA/, 'NNNNN'), [], { p1: ref }), 'missing-data')).toBe('bad') // 5 of 100
    expect(status(sampleQc(at(ref, 5, 'R'), [], { p1: ref }), 'mixed-sites')).toBe('mediocre')
    expect(status(sampleQc(at(at(at(ref, 5, 'R'), 20, 'Y'), 40, 'K'), [], { p1: ref }), 'mixed-sites')).toBe('bad')
    // Gaps are not missing data: only covered columns count.
    expect(status(sampleQc(`${'-'.repeat(50)}${ref.slice(50)}`, [], { p1: ref }), 'missing-data')).toBe('good')
  })

  it('takes frame and stops from the record checks', () => {
    const q = sampleQc(ref, [{ severity: 'warning', code: 'internal-stop', message: '' }, { severity: 'warning', code: 'frame-shifting-indel', message: '' }], { p1: ref })
    expect([status(q, 'frame'), status(q, 'stops'), q.overall]).toEqual(['bad', 'bad', 'bad'])
  })

  it('finds clustered differences against the nearest panel record, and ignores spread-out ones', () => {
    expect(clusters([10, 12, 15, 80, 90], 30, 3)).toEqual([{ start: 10, end: 15, count: 3 }])
    const spread = [10, 45, 80].reduce((s, i) => at(s, i, s[i] === 'A' ? 'C' : 'A'), ref)
    expect(status(sampleQc(spread, [], { p1: ref }), 'clustered-differences')).toBe('good')
    const clustered = [10, 12, 15].reduce((s, i) => at(s, i, s[i] === 'A' ? 'C' : 'A'), ref)
    const q = sampleQc(clustered, [], { far: 'T'.repeat(100), p1: ref })
    expect(q.nearest).toBe('p1')
    expect(status(q, 'clustered-differences')).toBe('mediocre')
    expect(q.rules.at(-1)!.detail).toContain('columns 11–16')
  })

  it('uses a panel\'s sealed thresholds when it has them', () => {
    const strict = { ...DEFAULT_QC, mixedSites: { mediocre: 1, bad: 1 } }
    const q = sampleQc(at(ref, 5, 'R'), [], { p1: ref }, strict)
    expect([status(q, 'mixed-sites'), q.settings]).toEqual(['bad', 'panel'])
  })
})
