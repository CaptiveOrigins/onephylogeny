import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { coveredColumns, geneChecks, geneCharsets, geneWindows, nexusRanges, parseGenBank, partitionNexus, reverseComplement, rotateToReference, type GenBankRecord } from '../src'

const reference = parseGenBank(readFileSync(new URL('../../../fixtures/NC_080265.1.gb', import.meta.url), 'utf8'))[0]!

describe('geneWindows on the redfoot reference (NC_080265.1)', () => {
  const g = geneWindows(reference)

  it('makes one window per annotated gene: 13 protein-coding, 2 rRNA and 22 tRNA', () => {
    const kinds = g.windows.map((w) => w.gene!.kind)
    expect(kinds.filter((k) => k === 'cds')).toHaveLength(13)
    expect(kinds.filter((k) => k === 'rrna')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'trna')).toHaveLength(22)
    expect(g.leftOut).toEqual([])
  })

  it('keeps reference order, half-open 0-based positions, unique ids, and the minus strand where annotated', () => {
    const starts = g.windows.map((w) => w.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(new Set(g.windows.map((w) => w.id)).size).toBe(g.windows.length)
    const nd6 = g.windows.find((w) => w.start === 13789)!
    expect(nd6).toMatchObject({ end: 14314, gene: { kind: 'cds', strand: '-' } })
  })

  it('keeps ND3, annotated in two parts around the extra base, as one window and says so', () => {
    expect(g.windows.find((w) => w.start === 9690)).toMatchObject({ end: 10042, gene: { kind: 'cds', strand: '+' } })
    expect(g.notes.join(' ')).toMatch(/2 parts .* skipped base\b/)
  })

  it('says the control region is unannotated rather than inventing one', () => {
    expect(g.notes.join(' ')).toMatch(/annotates no control region/)
  })

  it('counts overlapping genes once', () => {
    expect(coveredColumns([{ id: 'a', label: 'a', start: 0, end: 10 }, { id: 'b', label: 'b', start: 5, end: 20 }, { id: 'c', label: 'c', start: 30, end: 31 }])).toBe(21)
    expect(coveredColumns(g.windows)).toBeLessThan(reference.sequence.length)
  })
})

describe('geneWindows leaves out what it can\'t place plainly', () => {
  const rec = (features: GenBankRecord['features']): GenBankRecord => ({ accession: 'X', version: 'X.1', definition: '', organism: '', lineage: [], references: [], features, sequence: 'A'.repeat(1000) })
  const f = (key: string, location: string, gene?: string): GenBankRecord['features'][number] => ({ key, location, qualifiers: gene ? { gene: [gene] } : {} })

  it('leaves out the control region, partial ends, origin-crossing joins and unnamed genes, each with a reason', () => {
    const g = geneWindows(
      rec([f('D-loop', '900..1000'), f('CDS', '<1..120', 'COX1'), f('CDS', 'join(950..1000,1..40)', 'ND5'), f('tRNA', '200..270'), f('CDS', '300..1200', 'ND1'), f('rRNA', '400..500', 'rrnS')]),
    )
    expect(g.windows.map((w) => w.label)).toEqual(['rrnS'])
    expect(g.leftOut.map((x) => x.name)).toEqual(['control region', 'COX1', 'ND5', 'unnamed tRNA', 'ND1'])
    expect(g.leftOut.every((x) => x.reason.length > 10)).toBe(true)
  })

  it('tells two same-named genes apart by order', () => {
    const g = geneWindows(rec([f('tRNA', '500..560', 'tRNA-Leu'), f('tRNA', '100..160', 'tRNA-Leu')]))
    expect(g.windows.map((w) => [w.label, w.start])).toEqual([['tRNA-Leu (1)', 99], ['tRNA-Leu (2)', 499]])
  })
})

describe('rotateToReference and geneChecks on the redfoot reference', () => {
  const ref = reference.sequence.toUpperCase()
  const windows = geneWindows(reference).windows
  const cds = windows.filter((w) => w.gene?.kind === 'cds')

  it('turns a record that starts elsewhere, or reads on the other strand, back to the reference (whose own start is a tandem repeat)', () => {
    const turned = ref.slice(5000) + ref.slice(0, 5000)
    expect(rotateToReference(turned, ref)).toMatchObject({ status: 'rotated', strand: '+', sequence: ref })
    const flipped = reverseComplement(ref.slice(9000) + ref.slice(0, 9000))
    expect(rotateToReference(flipped, ref)).toMatchObject({ status: 'rotated', strand: '-', sequence: ref })
  })

  it('refuses a record where the reference start is nowhere', () => {
    expect(rotateToReference('ACGT'.repeat(4000), ref).status).toBe('refused')
  })

  it('reads every protein-coding gene on its own strand: the reference passes, ND6 included', () => {
    const checks = geneChecks(ref, ref, windows, 2)
    expect(checks).toHaveLength(13)
    const nd6 = checks.find((c) => c.window === cds.find((w) => w.gene!.strand === '-')!.id)!
    expect(nd6.status).toBe('ok')
    expect(checks.filter((c) => c.status !== 'ok' && c.status !== 'not-checked')).toEqual([])
  })

  it('flags an internal stop, a frameshift and a gene covered only in part', () => {
    const cox1 = cds.find((w) => w.label.toUpperCase().startsWith('COX1') || w.label.toUpperCase() === 'CO1')!
    const at = cox1.start + 300 // a codon boundary: the gene starts at its window start
    const withStop = ref.slice(0, at) + 'TAA' + ref.slice(at + 3)
    expect(geneChecks(withStop, ref, [cox1], 2)[0]!.status).toBe('stops')
    const shifted = ref.slice(0, at) + '-' + ref.slice(at + 1)
    expect(geneChecks(shifted, ref, [cox1], 2)[0]!.status).toBe('frame')
    const len = cox1.end - cox1.start
    const part = ref.slice(0, cox1.start) + '-'.repeat(Math.ceil(len * 0.1)) + ref.slice(cox1.start + Math.ceil(len * 0.1))
    expect(geneChecks(part, ref, [cox1], 2)[0]!.status).toBe('partial')
  })
})

describe('gene partitions for trees', () => {
  const w = (id: string, start: number, end: number, kind: 'cds' | 'rrna' | 'trna', strand: '+' | '-' = '+') => ({ id, label: id, start, end, gene: { kind, strand } })

  it('puts every column in exactly one set: codon positions per gene, minus strand counted from its end, overlaps and non-coding apart', () => {
    // Columns 0-29: geneA 0-11 (+), overlap 9-11 with geneB 9-20 (-), a tRNA 22-26, non-coding 21 and 27-29.
    const sets = geneCharsets([w('geneA', 0, 12, 'cds'), w('geneB', 9, 21, 'cds', '-'), w('tRNA-Leu', 22, 27, 'trna')], { start: 0, end: 30 })
    const all = sets.flatMap((s) => s.columns).sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    const by = Object.fromEntries(sets.map((s) => [s.name, s.columns]))
    expect(by.geneA_pos1).toEqual([1, 4, 7])
    expect(by.overlapping_genes).toEqual([10, 11, 12])
    // geneB reads from column 21 (1-based) down: 21 is its position 1, 20 position 2, 19 position 3.
    expect(by.geneB_pos1).toEqual([15, 18, 21])
    expect(by.tRNA_Leu).toEqual([23, 24, 25, 26, 27])
    expect(by.noncoding).toEqual([22, 28, 29, 30])
  })

  it('numbers columns from the start of the tree\'s window, and can keep genes whole', () => {
    const sets = geneCharsets([w('cytb', 100, 106, 'cds')], { start: 100, end: 106 }, { codonPositions: false })
    expect(sets).toEqual([{ name: 'cytb', columns: [1, 2, 3, 4, 5, 6] }])
  })

  it('writes NEXUS ranges with step 1 and step 3', () => {
    expect(nexusRanges([1, 4, 7, 10, 2, 3, 20])).toBe('1-4 7-10\\3 20')
    expect(partitionNexus([{ name: 'a_pos1', columns: [1, 4, 7] }, { name: 'nc', columns: [2, 3] }])).toBe('#nexus\nbegin sets;\n  charset a_pos1 = 1-7\\3;\n  charset nc = 2-3;\nend;\n')
  })

  it('on the redfoot reference, all 16,639 columns are assigned once', () => {
    const sets = geneCharsets(geneWindows(reference).windows, { start: 0, end: reference.sequence.length })
    expect(sets.reduce((n, s) => n + s.columns.length, 0)).toBe(reference.sequence.length)
    expect(sets.find((s) => s.name === 'overlapping_genes')!.columns.length).toBeGreaterThan(0)
  })
})
