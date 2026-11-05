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
  selection: { id: ID, title: 'Example', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'gene', gene: 'x', synonyms: [], products: [] }, outgroups: [{ accession: 'OUT91.1', rationale: 'Already chosen' }], exclude: [], filters: { minLength: 300, maxAmbiguous: 10 } },
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

  describe('Study', () => {
    const openStudy = async () => {
      await openProfile()
      tab('Study')
      fireEvent.click(screen.getByRole('button', { name: 'Search' }))
      return screen.findByText(/papers\. PubMed/, undefined, { timeout: 20_000 })
    }
    const column = (name: string) => within(screen.getByRole('region', { name }))
    const addNorth = async () => {
      await openStudy()
      fireEvent.click(screen.getByRole('button', { name: 'Add A study of the north' }))
      await screen.findByText('Save this Study?')
    }

    it('merges sources, names the record counts and keeps the search across tabs', async () => {
      await openProfile()
      tab('Study')
      fireEvent.change(screen.getByLabelText('Search papers'), { target: { value: 'north' } })
      fireEvent.click(screen.getByRole('button', { name: 'Search' }))
      const note = await screen.findByText(/papers\. PubMed/, undefined, { timeout: 20_000 })
      expect(note.textContent).toContain('Europe PMC 1')
      expect(column('Search results').getByText('12 records')).toBeTruthy()
      tab('Log')
      tab('Study')
      expect(column('Search results').getByText('12 records')).toBeTruthy()
    })

    it('offers to save with autosave on, then writes history that can be restored', async () => {
      await addNorth()
      expect((screen.getByRole('checkbox', { name: 'Autosave as you work' }) as HTMLInputElement).checked).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await screen.findByText('Autosaving')
      const dir = (await platform.list(`profiles/${ID}/studies`))[0]!
      expect(await platform.store.exists(`profiles/${ID}/studies/${dir}/study.json`)).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Add records' }))
      await column('Ingroup').findByText('N0.1')
      await waitFor(async () => expect((await platform.list(`profiles/${ID}/studies/${dir}/history`)).length).toBe(2))
      fireEvent.click(screen.getByRole('button', { name: 'History' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Restore 000001' }))
      await waitFor(() => expect(column('Ingroup').queryByText('N0.1')).toBeNull())
    })

    it('marks a Study not saved when the offer is declined', async () => {
      await addNorth()
      fireEvent.click(within(screen.getByText('Save this Study?').closest('form')!).getByRole('button', { name: 'Not now' }))
      expect(screen.getByText('Not saved')).toBeTruthy()
      expect(screen.queryByText('Save this Study?')).toBeNull()
    })

    it('moves with + and −, asks for a reason, and shows the omission faded', async () => {
      await addNorth()
      fireEvent.click(screen.getByRole('button', { name: 'Add records' }))
      await column('Ingroup').findByText('N0.1')
      fireEvent.click(screen.getByRole('button', { name: 'Move N1.1 right' }))
      expect(column('Outgroup').getByText('N1.1')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Move N1.1 left' }))
      expect(column('Ingroup').getByText('N1.1')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Move N0.1 left' }))
      expect(screen.getByRole('button', { name: 'Omit' }).hasAttribute('disabled')).toBe(true)
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Chimera noted in the paper' } })
      fireEvent.click(screen.getByRole('button', { name: 'Omit' }))
      expect(column('Ingroup').getByText(/Omitted before any result: Chimera/).closest('li')?.className).toContain('omitted')
    })

    it('uses the same rules when a record is dragged', async () => {
      await addNorth()
      fireEvent.click(screen.getByRole('button', { name: 'Add records' }))
      const row = (await column('Ingroup').findByText('N0.1')).closest('li')!
      const data = new Map<string, string>()
      const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '' }
      fireEvent.dragStart(row, { dataTransfer })
      fireEvent.drop(screen.getByRole('region', { name: 'Outgroup' }), { dataTransfer })
      expect(column('Outgroup').getByText('N0.1')).toBeTruthy()
    })

    it('hides and shows papers in the gene region, and links a paper to its records', async () => {
      await addNorth()
      fireEvent.click(screen.getByRole('button', { name: 'Add records' }))
      await column('Ingroup').findByText('N0.1')
      const region = screen.getByRole('region', { name: 'Gene region' })
      expect(within(region).getByRole('img').getAttribute('aria-label')).toContain('by 1 papers')
      fireEvent.click(within(region).getByRole('button', { name: 'Hide all' }))
      expect(within(region).getByRole('img').getAttribute('aria-label')).toContain('by 0 papers')
      const paper = column('Papers').getAllByRole('button').find((b) => b.className === 'link')!
      fireEvent.click(paper)
      expect(column('Ingroup').getByText('N0.1').closest('li')?.className).toContain('lit')
    })

    it('feeds a run through the normal fetch, keeps outgroups, and labels later omissions post hoc', async () => {
      await addNorth()
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await screen.findByText('Autosaving')
      fireEvent.click(screen.getByRole('button', { name: 'Add records' }))
      await column('Ingroup').findByText('N0.1')
      fireEvent.click(screen.getByRole('button', { name: 'Use this Study for the next fetch' }))
      await screen.findByText(/Set\. Open Records/)
      const saved = JSON.parse(await platform.store.read(`profiles/${ID}/profile.json`))
      expect(saved.selection.include).toHaveLength(12)
      expect(saved.selection.outgroups.map((o: { accession: string }) => o.accession)).toEqual(['OUT91.1'])
      const cur = parseCuration(await platform.store.read(`profiles/${ID}/curation.json`))
      expect(cur.records['N0.1']).toMatchObject({ group: 'north', study: expect.any(String) })
      tab('Records')
      fireEvent.click(screen.getByRole('button', { name: 'Fetch records' }))
      await screen.findByText(/13 records|12 records|records, \d+ passed/, undefined, { timeout: 20_000 })
      expect(screen.queryByRole('alert')).toBeNull()
      tab('Study')
      fireEvent.click(screen.getByRole('button', { name: 'Move N0.1 left' }))
      expect(screen.getByText(/will be labeled post hoc/)).toBeTruthy()
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Second thoughts' } })
      fireEvent.click(screen.getByRole('button', { name: 'Omit' }))
      expect(screen.getByText(/after a result \(post hoc\): Second thoughts/)).toBeTruthy()
    })
  })
})
