import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assessRead, readAbif } from '@captiveorigins/onephylogeny-core'
import type { Platform } from '../src/platform'
import { createPreviewPlatform } from '../src/platform-preview'
import { TraceInput } from '../src/Traces'

// Biopython's test files: 3730.ab1 is a good read, 310.ab1 a failed one (every quality zero).
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../../fixtures/abi', name)))
const good = fixture('3730.ab1')
const failed = fixture('310.ab1')
const kept = assessRead(readAbif(good))

/** A made-up reference holding the good read's kept stretch, with unrelated flanks, so both reads align to it. */
let x = 11
const random = (n: number) => Array.from({ length: n }, () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return 'ACGT'[(x >>> 0) % 4] }).join('')
const raw = readAbif(good).bases.slice(kept.kept!.start, kept.kept!.end).replace(/[^ACGT]/g, 'A')
const reference = random(200) + raw + random(200)

/**
 * The same good read with one well-called base changed in its base calls, standing in for a reverse read that disagrees
 * at one column. It's the same strand, not a real reverse read: the aligner turns real ones.
 */
const CHANGED = 400
function disagreeing(): Uint8Array {
  const copy = good.slice()
  const bases = readAbif(good).bases
  const needle = new TextEncoder().encode(bases)
  // Change the base in every copy of the base calls in the file (PBAS1 and PBAS2).
  for (let i = 0; i + needle.length <= copy.length; i++) {
    let hit = true
    for (let j = 0; j < needle.length && hit; j++) if (copy[i + j] !== needle[j]) hit = false
    if (hit) copy[i + CHANGED] = bases[CHANGED] === 'A' ? 'C'.charCodeAt(0) : 'A'.charCodeAt(0)
  }
  return copy
}

const setup = (files: { name: string; bytes: Uint8Array }[]) => {
  const platform: Platform = { ...createPreviewPlatform(), openChromatograms: async () => files }
  const onTest = vi.fn(async () => {})
  const attempt = async (_label: string, work: () => Promise<void>) => { await work() }
  render(<TraceInput platform={platform} hasPanel attempt={attempt} reference={async () => reference} onTest={onTest} />)
  return onTest
}
const openAndTest = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Open .ab1 files' }))
  await screen.findAllByRole('article')
  fireEvent.click(screen.getByRole('button', { name: 'Test reads against panel' }))
  await waitFor(() => expect(screen.getByRole('status', { name: 'Chromatogram outcome' }).textContent).not.toBe(''))
  return screen.getByRole('status', { name: 'Chromatogram outcome' }).textContent!
}
afterEach(cleanup)

describe('chromatograms as a sample in the Mac app', () => {
  it('shows a usable read\'s assessment in plain words, then tests its kept bases', async () => {
    const onTest = setup([{ name: '3730.ab1', bytes: good }])
    fireEvent.click(screen.getByRole('button', { name: 'Open .ab1 files' }))
    const card = within(await screen.findByRole('article', { name: 'Read 3730.ab1' }))
    const fact = (term: string) => card.getByText(term).nextElementSibling!.textContent
    expect(fact('Status')).toBe('Usable')
    expect(fact('Bases kept')).toBe(`${kept.sequence.length} of ${kept.rawLength} (bases ${kept.kept!.start + 1} to ${kept.kept!.end})`)
    expect(fact('Mean quality')).toBe(`Q${kept.meanQuality}`)
    expect(fact('Masked as N')).toBe(String(kept.maskedBases))
    expect(fact('Mixed peaks')).toBe(String(kept.mixedPeaks!.length))
    expect(card.getByText(/^Kept bases \d+ to \d+ of \d+ by quality\.$/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Test reads against panel' }))
    await waitFor(() => expect(onTest).toHaveBeenCalledTimes(1))
    expect(onTest).toHaveBeenCalledWith(kept.sequence, '226032_C-ME-18_pCAGseqF')
    expect(screen.getByRole('status', { name: 'Chromatogram outcome' }).textContent).toContain('Using 3730.ab1 alone.')
  })

  it('never tests a failed read, and says why', async () => {
    const onTest = setup([{ name: '310.ab1', bytes: failed }])
    fireEvent.click(screen.getByRole('button', { name: 'Open .ab1 files' }))
    const card = within(await screen.findByRole('article', { name: 'Read 310.ab1' }))
    expect(card.getByText('Status').nextElementSibling!.textContent).toBe('Failed')
    expect(card.getByText('Bases kept').nextElementSibling!.textContent).toMatch(/^None of \d+$/)
    expect(card.getByText(/No stretch of the read is above the quality cutoff/)).toBeTruthy()
    expect(await openAndTest()).toBe('Not tested: 310.ab1 failed. A failed or too-short read is never tested.')
    expect(onTest).not.toHaveBeenCalled()
  })

  it('refuses a file that isn\'t a chromatogram, without testing it', async () => {
    const onTest = setup([{ name: 'notes.ab1', bytes: new TextEncoder().encode('>not a chromatogram\nACGT\n'.padEnd(64)) }])
    expect(await openAndTest()).toContain("notes.ab1 couldn't be read")
    expect(screen.getByText(/Couldn't read this file: This isn't an ABI chromatogram/)).toBeTruthy()
    expect(onTest).not.toHaveBeenCalled()
  })

  it('joins two reads against the panel reference and counts the conflict, written as N', async () => {
    const onTest = setup([{ name: 'forward.ab1', bytes: good }, { name: 'reverse.ab1', bytes: disagreeing() }])
    const text = await openAndTest()
    expect(text).toMatch(/^Joined forward\.ab1 and reverse\.ab1: \d+ columns from both, 0 from the first only, 0 from the second only\. Conflicts: 1 \(a column where good bases disagree, written as N\)\./)
    expect(onTest).toHaveBeenCalledTimes(1)
    const [sequence, id] = onTest.mock.calls[0]! as unknown as [string, string]
    expect(id).toBe('226032_C-ME-18_pCAGseqF')
    // Same length as the kept read, and the one changed base is now N alongside the bases already masked for quality.
    expect(sequence).toHaveLength(kept.sequence.length)
    const at = CHANGED - kept.kept!.start
    expect(sequence[at]).toBe('N')
    expect(kept.sequence[at]).not.toBe('N')
    expect([...sequence].filter((c, i) => c !== kept.sequence[i])).toEqual(['N'])
  })

  it('uses the good read alone when the other failed, and says so', async () => {
    const onTest = setup([{ name: 'forward.ab1', bytes: good }, { name: 'reverse.ab1', bytes: failed }])
    expect(await openAndTest()).toContain('reverse.ab1 failed, so it isn\'t used. Only forward.ab1 is tested.')
    expect(onTest).toHaveBeenCalledWith(kept.sequence, '226032_C-ME-18_pCAGseqF')
  })

  it('takes at most two files', async () => {
    const onTest = setup([{ name: 'a.ab1', bytes: good }, { name: 'b.ab1', bytes: good }, { name: 'c.ab1', bytes: good }])
    fireEvent.click(screen.getByRole('button', { name: 'Open .ab1 files' }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Chromatogram outcome' }).textContent).toContain('3 were chosen'))
    expect((screen.getByRole('button', { name: 'Test reads against panel' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onTest).not.toHaveBeenCalled()
  })

  it('is hidden where files can\'t be opened, such as the browser preview', () => {
    render(<TraceInput platform={createPreviewPlatform()} hasPanel attempt={async (_l, w) => w()} reference={async () => null} onTest={async () => {}} />)
    expect(screen.queryByRole('button', { name: 'Open .ab1 files' })).toBeNull()
  })
})
