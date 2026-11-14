import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assessRead, reverseComplement, type ChromatogramRead } from '@extantape/onephylogeny-core'
import { describe, expect, it } from 'vitest'
import { joinPair, type AssessedRead } from '../src/sanger'

// Made-up reads in memory: bases with a quality per base, no traces. assessRead judges them as it would a real file.
let x = 11
const reference = Array.from({ length: 600 }, () => {
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return 'ACGT'[(x >>> 0) % 4]
}).join('')

const read = (file: string, bases: string, quality = 40): AssessedRead => {
  const r: ChromatogramRead = { format: 'abif', sampleName: file.replace('.ab1', ''), instrument: null, bases, quality: Array(bases.length).fill(quality), peaks: null, traces: null }
  return { file, sampleName: r.sampleName, assessment: assessRead(r) }
}
const other = (b: string) => (b === 'A' ? 'C' : 'A')

describe('joinPair: what sanger --reverse prints', () => {
  it('joins an overlapping forward and reverse read, and lists a good disagreement as N by its reference column', () => {
    // The reverse read covers columns 201 to 600 and differs at column 301 (index 300); it's given as sequenced, reverse-complemented.
    const rev = reference.slice(200, 300) + other(reference[300]!) + reference.slice(301)
    const p = joinPair(read('f.ab1', reference.slice(0, 400)), read('r.ab1', reverseComplement(rev)), reference)
    expect(p.status).toBe('joined')
    if (p.status !== 'joined') return
    expect(p.conflicts).toEqual([301])
    expect(p.span).toEqual({ start: 1, end: 600 })
    expect(p.sequence).toBe(reference.slice(0, 300) + 'N' + reference.slice(301))
    expect(p.columns).toEqual({ both: 200, forwardOnly: 200, reverseOnly: 200 })
    expect(p.used).toEqual(['f.ab1', 'r.ab1'])
    expect(p.notes.join(' ')).toMatch(/1 column where the two reads disagree/)
  })

  it('keeps both reads in place with N between them when they don\'t meet, and says so', () => {
    const p = joinPair(read('f.ab1', reference.slice(0, 250)), read('r.ab1', reverseComplement(reference.slice(350))), reference)
    expect(p.status).toBe('joined')
    if (p.status !== 'joined') return
    expect(p.sequence).toBe(reference.slice(0, 250) + 'N'.repeat(100) + reference.slice(350))
    expect(p.conflicts).toEqual([])
    expect(p.notes.join(' ')).toMatch(/don't overlap/)
    expect(p.notes.join(' ')).toMatch(/100 reference columns between them are written as N/)
  })

  it('leaves a deletion out of the FASTA and counts it', () => {
    // Columns 101 to 103 missing from the forward read, which alone covers them.
    const p = joinPair(read('f.ab1', reference.slice(0, 100) + reference.slice(103, 400)), read('r.ab1', reverseComplement(reference.slice(200))), reference)
    expect(p.status).toBe('joined')
    if (p.status !== 'joined') return
    expect(p.sequence).toBe(reference.slice(0, 100) + reference.slice(103))
    expect(p.notes.join(' ')).toMatch(/3 reference columns where the reads have a gap \(a deletion\) are left out/)
  })

  it('uses the other read alone when one failed or is too short, and names the one left out', () => {
    const good = read('f.ab1', reference.slice(0, 400))
    const failed = read('r.ab1', reverseComplement(reference.slice(200)), 0)
    expect(failed.assessment.status).toBe('failed')
    const p = joinPair(good, failed, reference)
    expect(p).toEqual({ status: 'single', sequence: reference.slice(0, 400), used: ['f.ab1'], notes: ['r.ab1 failed, so only f.ab1 is used, alone and not joined.'] })
    const short = read('f.ab1', reference.slice(0, 60))
    expect(short.assessment.status).toBe('short')
    const q = joinPair(short, read('r.ab1', reverseComplement(reference.slice(200))), reference)
    expect(q.status).toBe('single')
    if (q.status === 'single') {
      expect(q.used).toEqual(['r.ab1'])
      expect(q.notes[0]).toBe('f.ab1 is too short, so only r.ab1 is used, alone and not joined.')
    }
  })

  it('uses one read alone when the other doesn\'t align to the reference', () => {
    const p = joinPair(read('f.ab1', 'ACGT'.repeat(50)), read('r.ab1', reverseComplement(reference.slice(200))), reference)
    expect(p.status).toBe('single')
    if (p.status === 'single') {
      expect(p.used).toEqual(['r.ab1'])
      expect(p.notes[0]).toMatch(/Only r.ab1 aligns to the panel's reference, so f.ab1 is left out/)
    }
  })

  it('refuses when neither read can be used, or neither aligns', () => {
    const p = joinPair(read('f.ab1', reference.slice(0, 400), 0), read('r.ab1', reference.slice(0, 50)), reference)
    expect(p).toEqual({ status: 'refused', reason: 'Neither read can be used: f.ab1 failed and r.ab1 is too short. A failed or too-short read is never used.' })
    const q = joinPair(read('f.ab1', 'ACGT'.repeat(50)), read('r.ab1', 'TTTG'.repeat(50)), reference)
    expect(q.status).toBe('refused')
  })
})

describe('sanger on the command line', () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const cli = `${repo}packages/cli/dist/index.js`
  const run = (...a: string[]) => {
    try {
      execFileSync('node', [cli, ...a], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { code: 0, stderr: '' }
    } catch (e) {
      const err = e as { status: number; stderr: string }
      return { code: err.status, stderr: err.stderr }
    }
  }

  it('refuses --reverse without --dir, and --reverse without a file, in plain words', () => {
    expect(existsSync(cli), 'build the CLI first: pnpm build').toBe(true)
    expect(run('sanger', '--ab1', 'fixtures/abi/3730.ab1', '--reverse', 'fixtures/abi/310.ab1')).toEqual({ code: 1, stderr: "Joining two reads needs the panel's reference: add --dir with a built panel folder\n" })
    expect(run('sanger', '--ab1', 'fixtures/abi/3730.ab1', '--reverse', '--dir', 'x')).toEqual({ code: 1, stderr: '--reverse needs a file: the reverse read (.ab1)\n' })
  })
})
