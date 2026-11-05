import { describe, expect, it } from 'vitest'
import { canonicalJson, DEFAULT_GATES, panelChecksum, sealPanel, sequencesChecksum, validatePanel, validateResult, verifyPanel, type Panel, type Result } from '../src/index.js'

const panel: Panel = {
  schemaVersion: 2, id: 'p', version: '1', status: 'candidate',
  taxa: [{ source: 'ncbi-taxonomy', id: '1' }],
  marker: { kind: 'gene', gene: 'g' },
  reference: { accession: 'R1.1', length: 100 },
  windows: [{ id: 'w', label: 'W', start: 0, end: 100 }],
  pairs: [],
  claims: [],
  groups: [
    { id: 'a', label: 'A', coverage: [{ window: 'w', records: 1, blocks: 1, columnsAtDepth: [[0, 50]], spreadRate: null, recordsNeeded: 0 }], evidence: [{ record: 'r1', use: 'lineage-and-location', provenanceClass: 'wild-documented' }] },
    { id: 'b', label: 'B', coverage: [{ window: 'w', records: 1, blocks: 1, columnsAtDepth: [[50, 100]], spreadRate: null, recordsNeeded: 0 }], evidence: [{ record: 'r2', use: 'lineage-and-location', provenanceClass: 'wild-documented' }] },
  ],
  notCovered: ['Region X'], validatedScope: ['species'], sources: [{ citation: 'C' }], builtBy: 'run1', rules: { minSharedColumns: 50, minDepthPerColumn: 1, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 },
  gates: DEFAULT_GATES, sequencesChecksum: sequencesChecksum({}),
}
const codes = (p: Panel) => validatePanel(p).map((d) => d.code)

describe('panels', () => {
  it('accepts a valid panel', () => expect(validatePanel(panel)).toEqual([]))
  it('refuses assigned records as evidence of location', () => {
    const p = structuredClone(panel)
    p.groups[1]!.evidence[0]!.provenanceClass = 'seized'
    expect(codes(p)).toContain('invalid-location-evidence')
  })
  it('accepts a reported origin only when it names its source', () => {
    const p = structuredClone(panel)
    p.groups[0]!.evidence[0]!.provenanceClass = 'origin-reported'
    expect(codes(p)).toContain('origin-source-missing')
    p.groups[0]!.evidence[0]!.originSource = 'A paper, table 1'
    expect(codes(p)).not.toContain('origin-source-missing')
    expect(codes(p)).not.toContain('invalid-location-evidence')
  })
  it('refuses coordinates anywhere in a panel', () => {
    const p = structuredClone(panel) as Panel & { groups: (Panel['groups'][number] & { lat?: number })[] }
    p.groups[0]!.lat = 1
    expect(codes(p)).toContain('coordinates-in-panel')
  })
  it('refuses windows outside the reference', () => {
    const p = structuredClone(panel)
    p.windows[0]!.end = 101
    expect(codes(p)).toContain('window-range')
  })
  it('warns when coverage and validation are not stated', () => {
    expect(codes({ ...panel, notCovered: [], validatedScope: [] })).toEqual(expect.arrayContaining(['coverage-not-stated', 'not-validated']))
  })
  it('needs a seal to leave candidate, and detects later edits', () => {
    expect(codes({ ...panel, status: 'active' })).toContain('unsealed')
    const sealed = sealPanel(panel)
    expect(verifyPanel(sealed)).toBe(true)
    expect(validatePanel({ ...sealed, status: 'active' })).toEqual([])
    expect(codes({ ...sealed, status: 'active', notCovered: [] })).toContain('checksum-mismatch')
  })
  it('keeps its checksum when only status changes or keys are reordered', () => {
    expect(panelChecksum({ ...panel, status: 'superseded' })).toBe(panelChecksum(panel))
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }))
  })
})

describe('results', () => {
  const sealed = sealPanel(panel)
  const result: Result = {
    schemaVersion: 2, query: 'q', run: 'run2', overlap: 50, caveats: [], pairs: [], candidatesNotEvaluated: ['b'], novelty: { flagged: false, reasons: [], neitherSideSites: 0 }, outOfValidatedScope: [],
    panel: { id: 'p', version: '1', checksum: sealed.checksum! },
    findings: [
      { group: 'a', status: 'consistent', reasonCode: 'within-spread', reason: 'Matches at diagnostic sites', overlap: 50, informativeSites: 3, windows: [], evidence: ['r1'] },
      { group: 'b', status: 'not_evaluable', reasonCode: 'too-few-shared-columns', reason: 'No shared sites', overlap: 0, informativeSites: 0, windows: [], evidence: [] },
    ],
  }
  const rc = (r: Result, p?: Panel) => validateResult(r, p).map((d) => d.code)
  it('accepts a valid result', () => expect(validateResult(result, sealed)).toEqual([]))
  it('no shared sites can only be not_evaluable', () => {
    const r = structuredClone(result)
    r.findings[1]!.status = 'excluded_within_panel'
    expect(rc(r)).toContain('no-shared-sites')
  })
  it("can't exclude a group unless a resolved pair rules it out", () => {
    const r = structuredClone(result)
    r.findings[0]!.status = 'excluded_within_panel'
    expect(rc(r)).toContain('exclusion-without-pair')
    r.pairs = [{ a: 'a', b: 'b', state: 'resolved', reasonCode: 'decisive-sites', favors: 'b', sitesCovered: 3, forA: 0, forB: 3, neither: 0, ambiguous: 0 }]
    expect(rc(r)).not.toContain('exclusion-without-pair')
  })
  it('must name an exact panel, and match it', () => {
    expect(rc({ ...result, panel: { ...result.panel, checksum: '' } })).toContain('unscoped-result')
    expect(rc({ ...result, panel: { ...result.panel, version: '2' } }, sealed)).toContain('wrong-panel')
  })
  it('must report every group', () => {
    expect(rc({ ...result, findings: [result.findings[0]!] }, sealed)).toContain('missing-group')
  })
})
