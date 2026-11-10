import { describe, expect, it } from 'vitest'
import { conflictText, resultConflicts, type Result } from '../src/index.js'

const fw = (window: string, differences: number, sharedColumns = 100) => ({ window, sharedColumns, differences, unresolved: 0, allowedDifferences: 1, nearest: [] })
const finding = (group: string, status: string, windows = [fw('5p', 0), fw('3p', 0)]) => ({ group, status, reasonCode: 'within-spread', reason: '', overlap: 200, informativeSites: 0, windows, evidence: [] })
const pair = (a: string, b: string, favors?: string) => ({ a, b, state: favors ? 'resolved' : 'not_resolved', reasonCode: 'decisive-sites', ...(favors ? { favors } : {}), sitesCovered: 3, forA: 3, forB: 0, neither: 0, ambiguous: 0 })
const result = (over: Partial<Result>): Result => ({ schemaVersion: 2, query: 'q', run: 'r', overlap: 200, panel: { id: 'p', version: '1', checksum: 'x' }, findings: [], pairs: [], candidatesNotEvaluated: [], novelty: { flagged: false, reasons: [], neitherSideSites: 0 }, outOfValidatedScope: [], caveats: [], ...over } as Result)

describe('conflict reporting (roadmap stage 4)', () => {
  it('says nothing when the evidence points one way', () => {
    const r = result({ findings: [finding('a', 'consistent', [fw('5p', 0), fw('3p', 0)]), finding('b', 'excluded_within_panel', [fw('5p', 5), fw('3p', 6)])] as never, pairs: [pair('a', 'b', 'a')] as never })
    expect(resultConflicts(r)).toEqual([])
  })

  it('reports several consistent groups', () => {
    const r = result({ findings: [finding('b', 'consistent'), finding('a', 'consistent')] as never })
    expect(resultConflicts(r)[0]).toEqual({ kind: 'several-groups-consistent', groups: ['a', 'b'] })
  })

  it('reports windows that point to different groups, by rate rather than raw counts', () => {
    const r = result({ findings: [finding('a', 'consistent', [fw('5p', 0, 400), fw('3p', 4, 700)]), finding('b', 'inconclusive', [fw('5p', 3, 400), fw('3p', 1, 700)])] as never })
    expect(resultConflicts(r)).toEqual([{ kind: 'windows-disagree', windows: [{ window: '3p', closest: ['b'] }, { window: '5p', closest: ['a'] }] }])
    // A tie shared across windows isn't a disagreement.
    const tie = result({ findings: [finding('a', 'consistent', [fw('5p', 0), fw('3p', 1)]), finding('b', 'inconclusive', [fw('5p', 0), fw('3p', 0)])] as never })
    expect(resultConflicts(tie)).toEqual([])
  })

  it('reports comparisons that favour a ruled-out group, or go against the one that fits', () => {
    const r = result({ findings: [finding('a', 'consistent'), finding('b', 'excluded_within_panel'), finding('c', 'inconclusive')] as never, pairs: [pair('a', 'b', 'a'), pair('b', 'c', 'b'), pair('a', 'c', 'c')] as never })
    expect(resultConflicts(r)).toEqual([{ kind: 'comparisons-disagree', group: 'a', against: ['c'] }, { kind: 'comparisons-disagree', group: 'b', against: ['c'] }])
  })

  it('words each conflict plainly, with group labels', () => {
    expect(conflictText({ kind: 'windows-disagree', windows: [{ window: '3p', closest: ['b'] }, { window: '5p', closest: ['a'] }] }, (id) => id.toUpperCase())).toBe('Different parts of the gene point to different groups: 3p is closest to B; 5p is closest to A.')
  })
})
