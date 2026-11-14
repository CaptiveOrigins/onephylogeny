import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OutcomeRow, PerWindowReport, StudyOutReport } from '@extantape/onephylogeny-core'
import { OutcomesView } from '../src/index.js'

const interval = { method: 'clopper-pearson', level: 0.95, on: 'tests' } as PerWindowReport['interval']
const row = (group: string, window: string, tests: number, named: number): OutcomeRow => ({
  group, window, records: tests, notTestable: 0, sites: tests ? 2 : 0,
  outcomes: { tests, namedTruth: named, namedTruthAllCompared: named, truthKeptNotNamed: tests - named, wrong: 0, unresolved: 0, notEvaluable: 0 },
  ...(tests ? { namedTruth: { count: named, of: tests, lower: 0.5, upper: 1 }, truthKept: { count: tests, of: tests, lower: 0.7, upper: 1 }, wrong: { count: 0, of: tests, lower: 0, upper: 0.3 } } : {}),
})

describe('OutcomesView', () => {
  const windows: PerWindowReport = { scheme: 'leave-one-site-out-by-window', interval, diagnostics: [], windows: [
    { window: '3p', label: "3' window", separatingSites: 17, rows: [row('a', '3p', 10, 9), row('b', '3p', 0, 0)] },
    { window: '5p', label: "5' window", separatingSites: 0, rows: [row('a', '5p', 4, 0)] },
  ] }
  const studyOut: StudyOutReport = { scheme: 'leave-one-study-out-by-window', interval, studies: ['S1', 'S2'], rows: [], totals: [row('a', '3p', 10, 10)], recordsWithoutStudy: 3, diagnostics: [{ severity: 'warning', code: 'single-study-group', message: 'Every record of b comes from one study.' }] }

  it('gives each count out of its tests with an interval, never a bare rate, and says when there were no tests', () => {
    const html = renderToStaticMarkup(<OutcomesView windows={windows} studyOut={studyOut} />)
    expect(html).toContain('9 of 10 (50% to 100%)')
    expect(html).toContain('No tests')
    expect(html).not.toMatch(/\b90%/)
    expect(html).toContain('3&#x27; window, holding out each site (17 separating columns)')
    expect(html).toContain('holding out each study (2 studies)')
  })

  it('warns about a window that separates nothing, lists study warnings, and counts records with no study', () => {
    const html = renderToStaticMarkup(<OutcomesView windows={windows} studyOut={studyOut} />)
    expect(html).toContain('No column in this window separates any two groups')
    expect(html).toContain('Every record of b comes from one study.')
    expect(html).toContain('3 records name no study')
  })

  it('draws nothing for reports made before these existed', () => {
    expect(renderToStaticMarkup(<OutcomesView />)).toBe('')
  })
})
