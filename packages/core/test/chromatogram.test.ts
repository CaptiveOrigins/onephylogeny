import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { assessRead, checkPrimers, ChromatogramError, mottTrim, readAbif, reverseComplement, type ChromatogramRead } from '../src'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../fixtures/abi/${name}`, import.meta.url)))
const expected = JSON.parse(readFileSync(new URL('../../../fixtures/abi/expected.json', import.meta.url), 'utf8')) as Record<string, { bases: string; quality: number[]; sampleName: string }>

describe('readAbif on real files (checked against Biopython)', () => {
  it('reads a good 3730 read: the same bases, qualities and sample name Biopython reads', () => {
    const read = readAbif(fixture('3730.ab1'))
    expect(read.bases).toBe(expected['3730.ab1']!.bases)
    expect(read.quality).toEqual(expected['3730.ab1']!.quality)
    expect(read.sampleName).toBe(expected['3730.ab1']!.sampleName)
    expect(read.peaks).toHaveLength(read.bases.length)
    expect(read.traces && Object.keys(read.traces).sort()).toEqual(['A', 'C', 'G', 'T'])
  })

  it('reads a failed 310 read as it is: all qualities zero, nothing invented', () => {
    const read = readAbif(fixture('310.ab1'))
    expect(read.bases).toBe(expected['310.ab1']!.bases)
    expect(read.quality).toEqual(expected['310.ab1']!.quality)
  })
})

describe('readAbif refuses what it can\'t read', () => {
  it('refuses a file that isn\'t ABIF', () => {
    expect(() => readAbif(new TextEncoder().encode('>not a chromatogram\nACGT\n'.padEnd(64)))).toThrow(ChromatogramError)
  })
  it('refuses a cut-short file', () => {
    const bytes = fixture('3730.ab1').slice(0, 2000)
    expect(() => readAbif(bytes)).toThrow(/cut short|past the end/)
  })
})

describe('trimming and judging a read', () => {
  it('Mott trimming keeps the best stretch and returns null when none scores', () => {
    expect(mottTrim([0, 0, 40, 40, 40, 0, 0])).toEqual({ start: 2, end: 5 })
    expect(mottTrim([0, 0, 0, 5])).toBeNull()
  })

  it('a good read is usable, trimmed and with its low-quality bases as N', () => {
    const a = assessRead(readAbif(fixture('3730.ab1')))
    expect(a.status).toBe('usable')
    expect(a.kept!.start).toBeGreaterThan(0)
    expect(a.kept!.end).toBeLessThan(a.rawLength)
    expect(a.sequence).toHaveLength(a.kept!.end - a.kept!.start)
    expect(a.highQualityShare).toBeGreaterThan(0.9)
    expect(a.mixedPeaks).not.toBeNull()
  })

  it('a failed read is failed, with nothing kept', () => {
    const a = assessRead(readAbif(fixture('310.ab1')))
    expect(a.status).toBe('failed')
    expect(a.sequence).toBe('')
  })

  it('a read without qualities is failed rather than trusted', () => {
    const read: ChromatogramRead = { format: 'abif', sampleName: null, instrument: null, bases: 'ACGT'.repeat(50), quality: null, peaks: null, traces: null }
    const a = assessRead(read)
    expect(a.status).toBe('failed')
    expect(a.notes.join(' ')).toMatch(/no quality values/)
  })

  it('masks low bases inside the kept region, flags a strong second peak, and never changes other calls', () => {
    const n = 150
    const bases = 'A'.repeat(n)
    const quality = Array.from({ length: n }, (_, i) => (i === 75 ? 10 : 40))
    const peaks = Array.from({ length: n }, (_, i) => i * 10 + 5)
    const len = n * 10 + 10
    const A = new Int16Array(len).fill(0)
    const C = new Int16Array(len).fill(0)
    for (const p of peaks) A[p] = 1000
    C[peaks[40]!] = 600 // a 0.6 second peak at base 40
    const a = assessRead({ format: 'abif', sampleName: null, instrument: null, bases, quality, peaks, traces: { A, C, G: new Int16Array(len), T: new Int16Array(len) } })
    expect(a.status).toBe('usable')
    expect(a.maskedBases).toBe(1)
    expect(a.sequence[75 - a.kept!.start]).toBe('N')
    expect(a.sequence.replace('N', 'A')).toBe(bases.slice(a.kept!.start, a.kept!.end))
    expect(a.mixedPeaks).toEqual([{ position: 40 - a.kept!.start, called: 'A', second: 'C', ratio: 0.6 }])
  })

  it('a short kept region is short, not usable', () => {
    const a = assessRead({ format: 'abif', sampleName: null, instrument: null, bases: 'ACGT'.repeat(10), quality: Array(40).fill(40), peaks: null, traces: null })
    expect(a.status).toBe('short')
  })
})

describe('checkPrimers', () => {
  // A made-up reference: 40 bases of flank, a 300-base marker, 40 bases of flank.
  const rnd = (n: number, seed: number) => {
    let x = seed
    // xorshift: the low bits of a simple multiply-add generator repeat every 4, which would make every primer fit many places.
    return Array.from({ length: n }, () => {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return 'ACGT'[(x >>> 0) % 4]
    }).join('')
  }
  const left = rnd(40, 1)
  const marker = rnd(300, 2)
  const right = rnd(40, 3)
  const reference = left + marker + right
  const windows = [
    { id: '5p', label: "5' window", start: 0, end: 120 },
    { id: '3p', label: "3' window", start: 180, end: 300 },
  ]

  it('places primers in the flanks and covers both windows whole', () => {
    const forward = left.slice(10, 30)
    const reverse = reverseComplement(right.slice(5, 25))
    const c = checkPrimers({ forward, reverse, reference, windows, markerOffset: 40 })
    expect(c.status).toBe('ok')
    if (c.status !== 'ok') return
    expect(c.informative).toEqual({ start: 30 - 40, end: 345 - 40 })
    expect(c.windows.map((w) => w.coverage)).toEqual(['whole', 'whole'])
  })

  it('reports a window only partly covered, and leaves the primer sites out of what the sample tells', () => {
    const forward = marker.slice(100, 120)
    const reverse = reverseComplement(marker.slice(200, 220))
    const c = checkPrimers({ forward, reverse, reference: marker, windows })
    expect(c.status).toBe('ok')
    if (c.status !== 'ok') return
    expect(c.informative).toEqual({ start: 120, end: 200 })
    expect(c.windows).toEqual([
      { window: '5p', label: "5' window", coverage: 'none', columns: 0, of: 120 },
      { window: '3p', label: "3' window", coverage: 'partial', columns: 20, of: 120 },
    ])
  })

  it('accepts degenerate primer codes and a few mismatches', () => {
    const forward = 'N' + marker.slice(11, 30)
    const reverse = reverseComplement(marker.slice(250, 270))
    expect(checkPrimers({ forward, reverse, reference: marker, windows }).status).toBe('ok')
  })

  it('refuses a primer found nowhere, or the right way round reversed', () => {
    expect(checkPrimers({ forward: 'ACGTACGTACGTACGTACGT', reverse: reverseComplement(marker.slice(250, 270)), reference: marker, windows, maxMismatches: 0 }).status).toBe('refused')
    const swapped = checkPrimers({ forward: marker.slice(250, 270), reverse: reverseComplement(marker.slice(10, 30)), reference: marker, windows })
    expect(swapped.status).toBe('refused')
  })

  it('refuses a primer that fits two places equally well', () => {
    const repeat = 'ACGTTGCAACGTTGCAACGT'
    const ref = rnd(50, 4) + repeat + rnd(50, 5) + repeat + rnd(50, 6)
    const c = checkPrimers({ forward: repeat, reverse: reverseComplement(ref.slice(-30, -10)), reference: ref, windows: [] })
    expect(c.status).toBe('refused')
    if (c.status === 'refused') expect(c.reason).toMatch(/2 places/)
  })
})
