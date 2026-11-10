import { describe, expect, it } from 'vitest'
import { panelMethods, validatePanel, type Panel } from '../src/index.js'

const ev = (record: string) => ({ record, use: 'lineage-and-location' as const, provenanceClass: 'wild-documented' as const })
const panel = (over: Partial<Panel> = {}): Panel => ({
  schemaVersion: 2, id: 'p', version: '1', checksum: 'sha256:x', status: 'candidate', taxa: [{ source: 'ncbi-taxonomy', id: '1' }],
  marker: { kind: 'gene', gene: 'cytb', organelle: 'mitochondrion' }, reference: { accession: 'NC_1.1', length: 1140, geneticCode: 2 },
  windows: [{ id: 'w', label: 'Whole gene', start: 0, end: 1140 }], groups: [{ id: 'a', label: 'A', coverage: [], evidence: [ev('r1'), ev('r2')] }, { id: 'b', label: 'B', coverage: [], evidence: [ev('r3')] }],
  pairs: [], notCovered: ['Islands'], validatedScope: [], claims: [], sources: [{ citation: 'Author (2025) A study.', url: 'https://doi.org/10.0/x' }], builtBy: 'x',
  rules: { minSharedColumns: 100, minDepthPerColumn: 1, minBlocksForExclusion: 3, minDecisiveSites: 2, tolerance: 1 },
  gates: { minAlignedColumns: 100, minIdentity: 0.75, frameErrors: true }, sequencesChecksum: 'y', builtWith: [{ name: 'onephylogeny-engine', version: '0.1.0' }], ...over,
}) as Panel

describe('panel methods text (roadmap stage 5)', () => {
  it('describes the panel from what it records, with rules as configured values', () => {
    const { text, citations } = panelMethods(panel())
    expect(text).toContain('covers the cytb gene (mitochondrion) of NCBI Taxonomy 1. It holds 3 records in 2 groups, aligned to reference NC_1.1 (1140 columns), with reading frame checked under genetic code 2.')
    expect(text).toContain('at least 1 record,')
    expect(text).toContain('up to 1 difference beyond a group\'s own spread')
    expect(text).toContain('These are configured values, not calibrated probabilities.')
    expect(text).toContain('No claim has passed validation, so every result from this panel is exploratory.')
    expect(text).toContain('The panel does not cover: Islands.')
    expect(text).toContain('never proof of where an animal was collected')
    expect(text).toContain('No nuclear-copy screen was sealed into this panel.')
    expect(citations).toEqual(['Author (2025) A study. https://doi.org/10.0/x'])
  })

  it('counts validated claims by basis, and names a nuclear-copy screen', () => {
    const claim = { a: 'a', b: 'b', window: 'w', minColumns: 150, sites: { a: 3, b: 3 }, basis: 'exploratory' as const }
    const { text } = panelMethods(panel({ claims: [claim], validatedScope: ['a vs b in w'], numtCopies: [{ id: 'n1', aligned: 'A' }] }))
    expect(text).toContain('1 pairwise claim passed validation (0 confirmatory, 1 exploratory): a vs b in w.')
    expect(text).toContain('Samples are compared with 1 nuclear copy of the marker')
  })

  it('never writes a coordinate-like number', () => {
    expect(panelMethods(panel()).text).not.toMatch(/-?\d{1,3}\.\d{3,}/)
  })
})

describe('ecoregion tags (ADR 0008)', () => {
  it('accepts RESOLVE IDs on groups and refuses anything else', () => {
    const ok = panel({ groups: [{ id: 'a', label: 'A', coverage: [], evidence: [], ecoregions: [572, 583] }] })
    expect(validatePanel(ok).map((d) => d.code)).not.toContain('bad-ecoregion')
    const bad = panel({ groups: [{ id: 'a', label: 'A', coverage: [], evidence: [], ecoregions: [572.5, -1] }] })
    expect(validatePanel(bad).filter((d) => d.code === 'bad-ecoregion')).toHaveLength(2)
  })
})
