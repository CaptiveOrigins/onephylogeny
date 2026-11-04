import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  alignToReference, parseCuration, parseProfile, collapseHaplotypes, compareAligned, compatibility, coverage, extractLocation, findGeneFeatures, internalStops,
  parseFasta, parseGenBank, reverseComplement, toRecordSheet, toSequenceRecord, validateProfile, writeFasta, type Profile, type SequenceRecord,
} from '../src/index.js'

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8')

describe('known-answer distances (published values)', () => {
  type F = { records: { accession: string; group: string; aligned: string }[] }
  const { records } = JSON.parse(fixture('known-answer-distances.json')) as F
  const haps = (g: string) => [...new Set(records.filter((r) => r.group === g).map((r) => r.aligned))]
  const mean = (a: string, b: string) => {
    const d = haps(a).flatMap((x) => haps(b).map((y) => compareAligned(x, y).pDistance!))
    return (100 * d.reduce((s, v) => s + v, 0)) / d.length
  }
  // Between-group means from Vargas-Ramirez et al. 2010, Table 1 (percent, 420 bp alignment).
  it.each([
    ['N', 'NW', 1.508], ['N', 'NE', 2.103], ['NW', 'NE', 1.071], ['N', 'E', 3.155], ['NW', 'E', 2.361],
    ['NE', 'E', 1.527], ['N', 'S', 2.698], ['NW', 'S', 2.143], ['NE', 'S', 3.214], ['E', 'S', 4.462],
  ] as const)('%s to %s is close to %f%%', (a, b, published) => {
    expect(Math.abs(mean(a, b) - published)).toBeLessThan(0.15)
  })
})

describe('known-answer distances, through the aligner', () => {
  // The stored strings above came from MAFFT, so they can't catch a bug in our own aligner. This test can.
  type F = { records: { accession: string; group: string; aligned: string }[] }
  const { records } = JSON.parse(fixture('known-answer-distances.json')) as F
  const refRec = parseGenBank(fixture('golden/records.gb')).find((r) => r.version === 'NC_080265.1')!
  const reference = extractLocation(refRec.sequence, findGeneFeatures(refRec, ['cytb', 'CYTB', 'cob', 'cytochrome b'])[0]!.location)
  const aligned = new Map(records.map((r) => [r.accession, alignToReference(r.aligned.replace(/-/g, ''), reference)!.aligned]))
  const window = { start: 0, end: 433 }
  const haps = (g: string) => [...new Set(records.filter((r) => r.group === g).map((r) => aligned.get(r.accession)!))]
  const mean = (a: string, b: string) => {
    const d = haps(a).flatMap((x) => haps(b).map((y) => compareAligned(x, y, window).pDistance!))
    return (100 * d.reduce((s, v) => s + v, 0)) / d.length
  }
  it.each([
    ['N', 'NW', 1.508], ['N', 'NE', 2.103], ['NW', 'NE', 1.071], ['N', 'E', 3.155], ['NW', 'E', 2.361],
    ['NE', 'E', 1.527], ['N', 'S', 2.698], ['NW', 'S', 2.143], ['NE', 'S', 3.214], ['E', 'S', 4.462],
  ] as const)('%s to %s is close to %f%%', (a, b, published) => {
    expect(Math.abs(mean(a, b) - published)).toBeLessThan(0.15)
  })
  it('matches the anchored strings exactly', () => {
    for (const r of records) expect(aligned.get(r.accession)!.slice(0, 433), r.accession).toBe(r.aligned)
  })
})

describe('comparison', () => {
  it('missing data is never a difference', () => {
    expect(compareAligned('ACGT----', 'ACGTACGT')).toEqual({ overlap: 4, differences: 0, unresolved: 0, pDistance: 0 })
    expect(compareAligned('ACNT', 'ACGT').differences).toBe(0)
  })
  it('no shared sites means no measurement, not zero', () => {
    const c = compareAligned('ACGT----', '----ACGT')
    expect(c.overlap).toBe(0)
    expect(c.pDistance).toBeNull()
    expect(compatibility('ACGT----', '----ACGT')).toBe('not-evaluable')
  })
  it('separates ambiguity that could match from ambiguity that cannot', () => {
    expect(compareAligned('R', 'A')).toMatchObject({ unresolved: 1, differences: 0 })
    expect(compareAligned('R', 'C')).toMatchObject({ unresolved: 0, differences: 1 })
  })
  it('refuses sequences outside one coordinate system', () => {
    expect(() => compareAligned('ACGT', 'ACG')).toThrow(/coordinate/)
  })
  it('is symmetric', () => {
    expect(compareAligned('ACGTNA', 'ACCT-T')).toEqual(compareAligned('ACCT-T', 'ACGTNA'))
  })
})

describe('haplotypes', () => {
  it('never merges a shorter record into a longer one', () => {
    const h = collapseHaplotypes([{ id: 'long', aligned: 'ACGTACGT' }, { id: 'short', aligned: 'ACGT----' }])
    expect(h).toHaveLength(2)
    expect(compatibility('ACGTACGT', 'ACGT----')).toBe('compatible')
  })
  it('groups identical same-coverage records', () => {
    const h = collapseHaplotypes([{ id: 'a', aligned: 'AC-T' }, { id: 'b', aligned: 'AC-T' }, { id: 'c', aligned: 'AGGT' }])
    expect(h.map((x) => x.members)).toEqual([['a', 'b'], ['c']])
  })
  it('does not depend on record order beyond ids', () => {
    const r = [{ id: 'a', aligned: 'ACGT' }, { id: 'b', aligned: 'AGGT' }, { id: 'c', aligned: 'ACGT' }]
    const members = (x: typeof r) => collapseHaplotypes(x).map((h) => [...h.members].sort()).sort()
    expect(members([...r].reverse())).toEqual(members(r))
  })
})

describe('frames', () => {
  it('uses the stated genetic code', () => {
    expect(internalStops('ATGTGAATGATG', 0, 1)).toEqual([3])
    expect(internalStops('ATGTGAATGATG', 0, 2)).toEqual([])
    expect(internalStops('ATGAGAATGATG', 0, 2)).toEqual([3])
  })
  it('removes gaps first, so a deleted base shows up as a stop', () => {
    expect(internalStops('ATGGTAAGCTGCT', 0, 2)).toEqual([])
    expect(internalStops('AT-GTAAGCTGCT', 0, 2)).toEqual([3])
  })
  it('respects the reading frame', () => {
    expect(internalStops('GATGTAAGCTGCT', 1, 2)).toEqual([4])
    expect(internalStops('GATGTAAGCTGCT', 0, 2)).toEqual([])
  })
})

describe('GenBank', () => {
  const records = parseGenBank(fixture('two-records.gb'))
  const byId = Object.fromEntries(records.map((r) => [r.accession, r]))
  const q = byId.PQ562694!
  const f = byId.FN185755!
  it('reads identity, taxon and sequence', () => {
    expect(records).toHaveLength(2)
    expect(q.version).toBe('PQ562694.1')
    expect(q.sequence).toHaveLength(719)
    expect(f.sequence).toHaveLength(1179)
    expect(toSequenceRecord(q).taxon).toEqual({ source: 'ncbi-taxonomy', id: '50047' })
  })
  it('keeps the publication, which is where provenance often hides', () => {
    expect(q.references[0]!.title).toMatch(/^From captive to freedom/)
    expect(q.references.some((r) => r.title === 'Direct Submission')).toBe(false)
  })
  it('joins multi-line qualifiers and reads partial locations', () => {
    expect(f.features.find((x) => x.key === 'CDS')!.qualifiers.translation![0]).not.toMatch(/\s/)
    const cds = findGeneFeatures(f, ['cytb'])[0]!
    expect(cds.location).toBe('<1..>1179')
    expect(extractLocation(f.sequence, cds.location)).toBe(f.sequence)
  })
  it('matches gene names exactly, not by substring', () => {
    expect(findGeneFeatures(f, ['cyt'])).toHaveLength(0)
  })
  it('extracts joins and complements', () => {
    expect(extractLocation('AACCGGTT', 'join(1..2,7..8)')).toBe('AATT')
    expect(extractLocation('AACCGGTT', 'complement(1..3)')).toBe(reverseComplement('AAC'))
  })
  it('has no in-frame stops in a real CDS', () => {
    const cds = findGeneFeatures(q, ['cytb'])[0]!
    expect(internalStops(q.sequence, Number(cds.qualifiers.codon_start![0]) - 1, 2)).toEqual([])
  })
  it('starts provenance as unknown', () => {
    expect(toSequenceRecord(q).provenanceClass).toBe('unknown')
  })
})

describe('record sheet', () => {
  const base: SequenceRecord = { id: 'X1.1', accession: 'X1', version: 'X1.1', publications: [], sequenceLength: 3, sequenceSha256: 'sha256:0', provenanceClass: 'unknown', latLon: 'secret' }
  it('leaves coordinates out by default', () => {
    expect(toRecordSheet([base])).not.toContain('secret')
    expect(toRecordSheet([base], { includeCoordinates: true })).toContain('secret')
  })
  it('quotes commas and neutralizes formulas from source text', () => {
    const s = toRecordSheet([{ ...base, definition: 'a, b', isolate: '=HYPERLINK("x")' }])
    expect(s).toContain('"a, b"')
    expect(s).toContain(`"'=HYPERLINK(""x"")"`)
  })
})

describe('FASTA', () => {
  it('round-trips', () => {
    const parsed = parseFasta('>a desc here\nAC\nGT\n>b\nTT\n')
    expect(parsed).toEqual([{ id: 'a', description: 'desc here', sequence: 'ACGT' }, { id: 'b', description: '', sequence: 'TT' }])
    expect(writeFasta(parsed)).toBe('>a\nACGT\n>b\nTT\n')
  })
})

describe('profiles', () => {
  const good: Profile = {
    schemaVersion: 1, id: 'p', title: 'P',
    selection: { id: 's', title: 'S', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'gene', gene: 'g' }, outgroups: [{ accession: 'A1.1' }], exclude: [], filters: {} },
  }
  it('accepts a valid profile', () => expect(validateProfile(good)).toEqual([]))
  it('requires a reason for every exclusion', () => {
    const p = { ...good, selection: { ...good.selection, exclude: [{ accession: 'A1.1', reason: ' ' }] } }
    expect(validateProfile(p).map((d) => d.code)).toContain('exclusion-without-reason')
  })
  it('requires a taxon and warns on a missing outgroup', () => {
    const codes = validateProfile({ ...good, selection: { ...good.selection, taxa: [], outgroups: [] } }).map((d) => d.code)
    expect(codes).toEqual(expect.arrayContaining(['no-taxa', 'no-outgroup']))
  })
})

describe('species agnostic', () => {
  it('names no taxon in package source', () => {
    const dir = new URL('../src/', import.meta.url)
    const text = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n')
    expect(text).not.toMatch(/chelonoidis|carbonari|denticulat|testudin|tortoise|redfoot|colombia|cytb|cytochrome/i)
  })
})

describe('loading saved files', () => {
  it('explains a damaged or newer file instead of failing later', () => {
    expect(() => parseProfile('{oops')).toThrow(/not valid JSON/)
    expect(() => parseProfile(JSON.stringify({ schemaVersion: 2 }))).toThrow(/Update OnePhylogeny/)
    expect(() => parseProfile(JSON.stringify({ schemaVersion: 1, id: 'x' }))).toThrow(/missing required/)
    expect(() => parseCuration('[]')).toThrow(/damaged/)
    expect(parseCuration(JSON.stringify({ schemaVersion: 1, records: {} })).records).toEqual({})
  })
})
