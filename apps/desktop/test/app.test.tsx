import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES, fullValidation, parseCuration, type ValidationInput } from '@captiveorigins/onephylogeny-core'
import { EngineError } from '@captiveorigins/onephylogeny-engine'
import { App } from '../src/App'
import type { Platform } from '../src/platform'
import { createPreviewPlatform } from '../src/platform-preview'

// The real worker needs a browser. This lets a test hold a build open and then let it finish.
const hold = vi.hoisted(() => ({ gate: null as Promise<void> | null }))
vi.mock('../src/validate', () => ({
  validateInWorker: async (input: ValidationInput, signal?: AbortSignal) => {
    if (hold.gate) await Promise.race([hold.gate, new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new EngineError('cancelled', 'Cancelled'))))])
    return fullValidation(input)
  },
}))

const ID = 'example'
const groups = [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }]
const profile = {
  schemaVersion: 1, id: ID, title: 'Example taxon, gene x',
  selection: { id: ID, title: 'Example', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'gene', gene: 'x', synonyms: [], products: [] }, outgroups: [], exclude: [], filters: { minLength: 300, maxAmbiguous: 10 } },
  reference: { accession: 'REF1.1' },
  tree: { model: 'MFP', bootstrap: 1000, shAlrt: 1000, seed: 1, threads: 1 },
  panel: { id: 'example-panel', version: '0.1.0', groups, notCovered: [], validatedScope: [], rules: DEFAULT_RULES },
}
const curation = () => {
  const records: Record<string, { group: string; site: string; provenanceClass: string }> = {}
  for (let i = 0; i < 12; i++) records[`N${i}.1`] = { group: 'north', site: `n${i % 4}`, provenanceClass: 'wild-documented' }
  for (let i = 0; i < 9; i++) records[`S${i}.1`] = { group: 'south', site: `s${i % 3}`, provenanceClass: 'wild-documented' }
  return { schemaVersion: 1, records }
}

let platform: Platform
let clock: number
beforeEach(async () => {
  hold.gate = null
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  platform = createPreviewPlatform()
  await platform.store.write(`profiles/${ID}/profile.json`, JSON.stringify(profile))
  await platform.store.write(`profiles/${ID}/curation.json`, JSON.stringify(curation()))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const openProfile = async () => {
  render(<App platform={platform} />)
  fireEvent.click(await screen.findByRole('button', { name: ID }))
  await screen.findByRole('tablist')
}
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
const fetchRecords = async () => {
  tab('Records')
  fireEvent.click(screen.getByRole('button', { name: 'Fetch records' }))
  await screen.findByRole('button', { name: 'Fetch again' }, { timeout: 20_000 })
}

describe('the Mac app, clicked through', () => {
  // Every action goes through one guard. When that guard was wrong, each of these clicks did nothing and no other test noticed.
  it('opens a profile and creates another', async () => {
    await openProfile()
    expect(screen.getByRole('heading', { name: 'Example taxon, gene x' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }))
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Second species' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('heading', { name: 'Second species' })).toBeTruthy()
  })

  it('says what a study-wide provenance change did, and saves it', async () => {
    await openProfile()
    await fetchRecords()
    fireEvent.change(screen.getByRole('combobox', { name: 'Provenance for A study of the south' }), { target: { value: 'seized' } })
    expect(screen.getByRole('status').textContent).toContain('Setting 9 records')
    await screen.findByText(/Saved: 9 records set to Seized/)
    const saved = parseCuration(await platform.store.read(`profiles/${ID}/curation.json`))
    expect(saved.records['S0.1']?.provenanceClass).toBe('seized')
    const row = screen.getByRole('rowheader', { name: 'A study of the south' }).closest('tr')!
    expect(within(row).getByText('9 Seized')).toBeTruthy()
  })

  it('keeps a build and its clock going across tabs, then shows the result', async () => {
    await openProfile()
    await fetchRecords()
    let release = () => {}
    hold.gate = new Promise<void>((r) => { release = r })
    tab('Panel')
    fireEvent.click(screen.getByRole('button', { name: 'Build and validate panel' }))
    await screen.findByText(/Each testable pair/)

    clock += 65_000
    tab('Log')
    expect(screen.queryByText(/Each testable pair/)).toBeNull()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Building panel… 1:05'), { timeout: 2000 })
    clock += 10_000
    tab('Panel')
    // A clock kept inside the tab would have restarted at 0:00 here.
    expect((await screen.findByText(/Each testable pair/)).textContent).toContain('Building and validating… 1:15')

    await act(async () => { release() })
    await screen.findByRole('heading', { name: 'example-panel version 0.1.0' }, { timeout: 20_000 })
    expect(screen.queryByText(/Each testable pair/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('tells you when a second job has to wait, instead of ignoring the click', async () => {
    await openProfile()
    await fetchRecords()
    let release = () => {}
    hold.gate = new Promise<void>((r) => { release = r })
    tab('Panel')
    fireEvent.click(screen.getByRole('button', { name: 'Build and validate panel' }))
    await screen.findByText(/Each testable pair/)
    tab('Setup')
    fireEvent.change(screen.getByLabelText('Search by scientific name'), { target: { value: 'Genus species' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Building panel')
    expect(screen.getByRole('status').textContent).toContain('Building panel')
    await act(async () => { release() })
  })

  it('cancels a running job and lets the next one start', async () => {
    await openProfile()
    await fetchRecords()
    hold.gate = new Promise<void>(() => {})
    tab('Panel')
    fireEvent.click(screen.getByRole('button', { name: 'Build and validate panel' }))
    await screen.findByText(/Each testable pair/)
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Cancel' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Finished steps are kept')
    expect(screen.queryByText(/Each testable pair/)).toBeNull()
    hold.gate = null
    fireEvent.click(screen.getByRole('button', { name: 'Build and validate panel' }))
    await screen.findByRole('heading', { name: 'example-panel version 0.1.0' }, { timeout: 20_000 })
  })
})
