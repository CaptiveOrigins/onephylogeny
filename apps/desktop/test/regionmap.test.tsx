import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ECOREGIONS_CREDIT, type Ecoregions } from '@captiveorigins/onephylogeny-react'

// Mocked Tauri file system and resource path: this checks how the Mac app reads the outlines, not the real bundle.
const fs = vi.hoisted(() => ({ files: new Map<string, string>(), unreadable: false, reads: 0 }))
vi.mock('@tauri-apps/plugin-store', () => ({ load: async () => ({ get: async () => '/ws', set: async () => {} }) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ resolveResource: async (p: string) => `/App.app/Contents/Resources/${p}` }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), ask: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (p: string) => fs.files.has(p),
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async (p: string) => {
    fs.reads++
    if (fs.unreadable) throw new Error('permission denied')
    return fs.files.get(p) ?? Promise.reject(new Error(`no file ${p}`))
  },
  writeTextFile: async () => {},
  rename: async () => {},
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))

import type { Platform } from '../src/platform'
import { createMacPlatform } from '../src/platform-mac'
import { createPreviewPlatform } from '../src/platform-preview'
import { RegionMapSection } from '../src/RegionMapSection'

const OUTLINES = '/App.app/Contents/Resources/resources/ecoregions.json'
// Made-up squares in made-up places: just enough shape to draw, nothing real.
const square = (x: number, y: number): [number, number][][] => [[[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2], [x, y]]]
const outlines: Ecoregions = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { ECO_ID: 1, ECO_NAME: 'Example moist forests' }, geometry: { type: 'Polygon', coordinates: square(0, 0) } },
    { type: 'Feature', properties: { ECO_ID: 2, ECO_NAME: 'Example dry forests' }, geometry: { type: 'Polygon', coordinates: square(3, 0) } },
    { type: 'Feature', properties: { ECO_ID: 3, ECO_NAME: 'Example grasslands' }, geometry: { type: 'Polygon', coordinates: square(1, 3) } },
  ],
}
const untagged = { groups: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }] }
const tagged = { groups: [{ id: 'north', label: 'North', ecoregions: [1] }, { id: 'south', label: 'South', ecoregions: [2] }] }
const withOutlines = (load: Platform['ecoregions']): Platform => ({ ...createPreviewPlatform(), ecoregions: load })

beforeEach(() => {
  fs.files.clear()
  fs.unreadable = false
  fs.reads = 0
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('the region map in the Panel tab', () => {
  it('says no group is tagged yet, draws no map, and reads no outlines', async () => {
    const load = vi.fn(async () => outlines)
    render(<RegionMapSection panel={untagged} platform={withOutlines(load)} />)
    const map = within(screen.getByRole('region', { name: 'Region map' }))
    expect(map.getByText(/No group in this panel is tagged with an ecoregion yet/)).toBeTruthy()
    expect(map.queryByRole('img')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('draws the tagged ecoregions with the legend, the table and the credit line', async () => {
    render(<RegionMapSection panel={tagged} platform={withOutlines(async () => outlines)} />)
    const map = within(screen.getByRole('region', { name: 'Region map' }))
    const img = await map.findByRole('img')
    expect(img.getAttribute('aria-label')).toBe('Map of the ecoregions behind 2 groups: North, 1 ecoregions; South, 1 ecoregions. The table below lists them.')
    expect(map.getByText((_, el) => el?.tagName === 'FIGCAPTION' && el.textContent!.includes(ECOREGIONS_CREDIT))).toBeTruthy()
    expect(within(map.getByRole('list', { name: 'Groups' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['North', 'South'])
    // The table is the screen-reader and keyboard route to the same facts: a native disclosure, so it opens from the keyboard.
    expect(map.getByText('As a table').tagName).toBe('SUMMARY')
    expect(map.getByRole('rowheader', { name: 'North' }).nextElementSibling!.textContent).toBe('Example moist forests')
    expect(map.queryByRole('alert')).toBeNull()
  })

  it('says clearly when the outlines are missing or unreadable, and still lists the tags', async () => {
    render(<RegionMapSection panel={tagged} platform={withOutlines(async () => { throw new Error("the outlines aren't in this copy of the app") })} />)
    const map = within(screen.getByRole('region', { name: 'Region map' }))
    expect((await map.findByRole('alert')).textContent).toBe("The region map can't be drawn: the outlines aren't in this copy of the app. Reinstalling the app puts the outlines back.")
    expect(map.queryByRole('img')).toBeNull()
    expect(map.getByRole('rowheader', { name: 'South' }).nextElementSibling!.textContent).toBe('2')
  })

  it('says so in the browser preview, which has no outlines', async () => {
    render(<RegionMapSection panel={tagged} platform={createPreviewPlatform()} />)
    expect((await screen.findByRole('alert')).textContent).toContain("this copy of the app doesn't include the outlines")
  })
})

describe('the Mac app reading the outlines', () => {
  it('reads them from inside the app, once', async () => {
    fs.files.set(OUTLINES, JSON.stringify(outlines))
    const mac = await createMacPlatform()
    expect((await mac.ecoregions!()).features).toHaveLength(3)
    await mac.ecoregions!()
    expect(fs.reads).toBe(1)
  })

  it('refuses a missing, unreadable or wrong file with a reason, and tries again next time', async () => {
    const mac = await createMacPlatform()
    await expect(mac.ecoregions!()).rejects.toThrow("the outlines aren't in this copy of the app")
    fs.files.set(OUTLINES, JSON.stringify(outlines))
    fs.unreadable = true
    await expect(mac.ecoregions!()).rejects.toThrow("the outlines file couldn't be read (permission denied)")
    fs.unreadable = false
    fs.files.set(OUTLINES, '{"type":"FeatureColl')
    await expect(mac.ecoregions!()).rejects.toThrow("the outlines file isn't valid JSON")
    fs.files.set(OUTLINES, JSON.stringify({ type: 'FeatureCollection', features: [{ properties: { name: 'x' } }] }))
    await expect(mac.ecoregions!()).rejects.toThrow(/isn't the RESOLVE Ecoregions GeoJSON/)
    // Once the file is right, the earlier failures aren't remembered.
    fs.files.set(OUTLINES, JSON.stringify(outlines))
    expect((await mac.ecoregions!()).features).toHaveLength(3)
  })

  it('shows the map in the Panel tab from the outlines inside the app', async () => {
    fs.files.set(OUTLINES, JSON.stringify(outlines))
    render(<RegionMapSection panel={tagged} platform={await createMacPlatform()} />)
    expect(await screen.findByRole('img')).toBeTruthy()
  })
})
