import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { comparePanels, comparisonMarkdown, DEFAULT_RULES, type ClaimReport, type Panel, type Profile } from '@captiveorigins/onephylogeny-core'
import { ComparisonView } from '@captiveorigins/onephylogeny-react'
import { buildPanelFromRun, fetchAndAnchor, panelVersionComparison, profilePaths, type EngineContext } from '@captiveorigins/onephylogeny-engine'
import { comparisonPath, CompareRuns } from '../src/CompareRuns'
import type { Platform } from '../src/platform'
import { createPreviewPlatform } from '../src/platform-preview'

// The browser preview's platform: an in-memory store and made-up NCBI answers. No Tauri call is made, so nothing here
// touches a real file; the Mac store's own writes are covered in platform-mac.test.tsx.
const ID = 'example'
const profile = {
  schemaVersion: 1, id: ID, title: 'Example taxon, gene x',
  selection: { id: ID, title: 'Example', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'gene', gene: 'x', synonyms: [], products: [] }, outgroups: [{ accession: 'OUT91.1', rationale: 'Already chosen' }], exclude: [], filters: { minLength: 300, maxAmbiguous: 10 } },
  reference: { accession: 'REF1.1' },
  panel: { id: 'example-panel', version: '0.1.0', groups: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }], notCovered: [], validatedScope: [], rules: DEFAULT_RULES },
} as unknown as Profile
const curation = (moved?: string) => {
  const records: Record<string, { group: string; site: string; provenanceClass: 'wild-documented' }> = {}
  for (let i = 0; i < 12; i++) records[`N${i}.1`] = { group: 'north', site: `n${i % 4}`, provenanceClass: 'wild-documented' }
  for (let i = 0; i < 9; i++) records[`S${i}.1`] = { group: 'south', site: `s${i % 3}`, provenanceClass: 'wild-documented' }
  if (moved) records[moved]!.group = 'south'
  return { schemaVersion: 1 as const, records }
}

let platform: Platform
const errors: string[] = []
// The app's own guard shows errors; this one records them, so a refusal can be checked.
const attempt = async (_label: string, work: () => Promise<void>) => { try { await work() } catch (e) { errors.push(e instanceof Error ? e.message : String(e)) } }
const show = (p: Platform = platform) => render(<CompareRuns profile={profile} platform={p} attempt={attempt} busy={false} />)

beforeAll(async () => {
  platform = createPreviewPlatform()
  const ctx: EngineContext = { store: platform.store, ncbi: { fetch: platform.fetch, tool: 'test' } }
  await fetchAndAnchor(ctx, profile)
  await buildPanelFromRun(ctx, profile, curation())
  await buildPanelFromRun(ctx, { ...profile, panel: { ...profile.panel!, version: '0.2.0' } }, curation('N11.1'))
}, 60_000)
afterEach(() => { cleanup(); errors.length = 0; vi.restoreAllMocks() })

const compared = async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
  return within(await screen.findByRole('region', { name: 'Comparison' }))
}

describe('comparing panel versions in the Mac app', () => {
  it('picks the two newest, and shows what moved and each version\'s outcomes in captioned tables', async () => {
    show()
    expect(await screen.findByText(/2 versions built for this profile: 0.1.0, 0.2.0/)).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Version A' }) as HTMLSelectElement).value).toBe('0.1.0')
    expect((screen.getByRole('combobox', { name: 'Version B' }) as HTMLSelectElement).value).toBe('0.2.0')
    cleanup()
    const view = await compared()
    const moved = view.getByRole('table', { name: 'Records that changed group' })
    expect(within(moved).getByRole('rowheader', { name: 'N11.1' }).closest('tr')!.textContent).toBe('N11.1NorthSouth')
    expect(view.getByText(/Groups/, { selector: 'p' })).toBeTruthy()
    const outcomes = view.getByRole('table', { name: /holding out each site/ })
    expect(within(outcomes).getByRole('rowheader', { name: 'North, version 0.1.0' })).toBeTruthy()
    expect(within(outcomes).getByRole('rowheader', { name: 'South, version 0.2.0' })).toBeTruthy()
    // Counts out of tests with intervals, or "No tests"; never a bare rate.
    for (const cell of within(outcomes).getAllByRole('cell')) expect(cell.textContent).toMatch(/^(\d+|–|No tests|Not in this version|\d+ of \d+ \(\d+% to \d+%\))$/)
    expect(errors).toEqual([])
  })

  it('clears a comparison when the versions change, and won\'t compare a version with itself', async () => {
    const view = await compared()
    expect(view.getByText(/1 of the shared records changed group/)).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Version B' }), { target: { value: '0.1.0' } })
    expect(screen.queryByRole('region', { name: 'Comparison' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Pick two different versions.')).toBeTruthy()
  })

  it('shows unchanged claims only when asked', () => {
    // Made-up panels with two claims, one unchanged: the built example has only one claim.
    const p = (version: string) => ({ schemaVersion: 2, id: 'p', version, checksum: `sha256:${version}`, windows: [{ id: 'w', label: 'Whole', start: 0, end: 10 }], groups: [{ id: 'n', label: 'North', evidence: [] }, { id: 's', label: 'South', evidence: [] }, { id: 't', label: 'East', evidence: [] }], sequencesChecksum: 'x' }) as unknown as Panel
    const claim = (b: string, passed: boolean) => ({ a: 'n', b, window: 'w', passed, sites: { a: 4, b: 4 }, records: { a: 5, b: 5 }, gates: [{ gate: 'sites', passed, ran: true, detail: '' }] }) as ClaimReport
    render(<ComparisonView comparison={comparePanels(p('1'), p('2'), { claims: [claim('s', false), claim('t', true)] }, { claims: [claim('s', true), claim('t', true)] })} />)
    const claims = () => within(screen.getByRole('table', { name: /claim/i })).getAllByRole('rowheader').map((h) => h.textContent)
    expect(claims()).toEqual(['North vs South, Whole'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show unchanged claims' }))
    expect(claims()).toEqual(['North vs South, Whole', 'North vs East, Whole'])
  })

  it('saves the same Markdown the CLI prints, beside the profile, and can show the file', async () => {
    const reveal = vi.spyOn(platform, 'reveal').mockResolvedValue()
    const view = await compared()
    fireEvent.click(view.getByRole('button', { name: 'Save as Markdown' }))
    const path = comparisonPath(profile, '0.1.0', '0.2.0')
    expect(path).toBe(`${profilePaths(ID).profile.replace(/\/profile\.json$/, '')}/comparisons/example-panel-0.1.0-vs-0.2.0.md`)
    expect((await view.findByRole('status')).textContent).toContain(`Saved to ${path}`)
    expect(await platform.store.read(path)).toBe(comparisonMarkdown(await panelVersionComparison(platform.store, profile, '0.1.0', '0.2.0')))
    fireEvent.click(view.getByRole('button', { name: 'Show file' }))
    expect(reveal).toHaveBeenCalledWith(path)
  })

  it('refuses a version whose files changed after sealing, and shows no comparison', async () => {
    const copy = createPreviewPlatform()
    const dir = (v: string) => profilePaths(ID).panel('example-panel', v)
    for (const v of ['0.1.0', '0.2.0']) for (const f of ['panel.json', 'panel.fasta', 'validation.json']) await copy.store.write(`${dir(v)}/${f}`, await platform.store.read(`${dir(v)}/${f}`))
    const tampered = JSON.parse(await copy.store.read(`${dir('0.2.0')}/panel.json`))
    tampered.notCovered = ['changed by hand']
    await copy.store.write(`${dir('0.2.0')}/panel.json`, JSON.stringify(tampered))
    show(copy)
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
    await waitFor(() => expect(errors.join()).toMatch(/seal/))
    expect(screen.queryByRole('region', { name: 'Comparison' })).toBeNull()
  })

  it('says what to do with fewer than two versions', async () => {
    show(createPreviewPlatform())
    expect(await screen.findByText('No panel versions are built yet.')).toBeTruthy()
  })
})
