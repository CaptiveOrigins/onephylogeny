import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchLike, PublicListings } from '@extantape/onephylogeny-acquire'
import type { Profile } from '@extantape/onephylogeny-core'
import type { EngineContext } from '@extantape/onephylogeny-engine'
import type { Platform } from '../src/platform'
import { createPreviewPlatform } from '../src/platform-preview'
import { PUBLIC_ROWS, PublicDataSection, PublicListingsView } from '../src/PublicDataSection'

// The browser preview's platform answers every service with made-up data, so no request leaves the machine. The real
// services' answers are covered by the acquire tests; here it's what the section asks, when, and what it shows.
const profile = {
  schemaVersion: 1, id: 'example', title: 'Example taxon, gene x',
  selection: { id: 'example', title: 'Example', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'gene', gene: 'x', synonyms: [], products: [] }, outgroups: [], exclude: [], filters: { minLength: 300, maxAmbiguous: 10 } },
} as unknown as Profile

const errors: string[] = []
const attempt = async (_label: string, work: () => Promise<void>) => { try { await work() } catch (e) { errors.push(e instanceof Error ? e.message : String(e)) } }
/** A platform whose fetch records every URL, and fails the hosts named in `down`. */
const recording = (down: RegExp | null = null) => {
  const base = createPreviewPlatform()
  const urls: string[] = []
  const fetch: FetchLike = async (url, init) => {
    urls.push(url)
    if (down?.test(url)) return { ok: false, status: 503, text: async () => '' }
    return base.fetch(url, init)
  }
  const platform: Platform = { ...base, fetch }
  const context = (): EngineContext => ({ store: platform.store, ncbi: { fetch, tool: 'onephylogeny-mac' } })
  return { platform, context, urls }
}
const show = (r: ReturnType<typeof recording>, p: Profile = profile) => render(<PublicDataSection profile={p} platform={r.platform} context={r.context} attempt={attempt} busy={false} />)
const section = () => within(screen.getByRole('region', { name: 'Public data' }))
const listed = () => screen.findByRole('region', { name: 'Public data listings' }, { timeout: 20_000 })

afterEach(() => { cleanup(); errors.length = 0; vi.restoreAllMocks() })

describe('public data in the Study tab', () => {
  it('asks nothing until the button is pressed, and says these are listings and counts, not evidence, never coordinates', async () => {
    const r = recording()
    show(r)
    await new Promise((done) => setTimeout(done, 50))
    expect(r.urls).toEqual([])
    const text = screen.getByRole('region', { name: 'Public data' }).textContent!
    expect(text).toContain('These are listings and counts, not evidence')
    expect(text).toContain('No coordinates are fetched or shown')
    expect(text).toContain('only when you press the button')
  })

  it('lists every source in captioned tables, with the query and when it was retrieved', async () => {
    const r = recording()
    show(r)
    fireEvent.click(section().getByRole('button', { name: 'List public data' }))
    const view = within(await listed())
    expect(view.getByText(/GBIF, iDigBio and BOLD were asked about Example taxon, NCBI Taxonomy's name for taxon 1/)).toBeTruthy()
    for (const caption of ['SRA runs', 'Genome assemblies', 'GBIF records by country', 'GBIF records by basis of record', 'GBIF records by licence', 'iDigBio records by country', 'BOLD records by country or ocean', 'BOLD records by marker']) expect(view.getByRole('table', { name: caption })).toBeTruthy()
    const sra = within(view.getByRole('table', { name: 'SRA runs' }))
    expect(sra.getByRole('rowheader', { name: 'SRR0000001' }).closest('tr')!.textContent).toBe('SRR0000001WGSPAIREDILLUMINA900,000PRJNA0SAMN02024/01/01')
    expect(within(view.getByRole('table', { name: 'GBIF records by country' })).getByRole('rowheader', { name: 'XA' }).nextElementSibling!.textContent).toBe('80')
    expect(view.getByText(/iDigBio doesn't index a licence per record. Each recordset states its own rights/)).toBeTruthy()
    expect(view.getAllByText(/^Query:/).length).toBe(5)
    expect(view.getByText((_, el) => el?.tagName === 'CODE' && el.textContent!.startsWith('https://api.gbif.org/v1/occurrence/search?taxonKey=1&limit=0'))).toBeTruthy()
    expect(view.getAllByText(/Retrieved \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/).length).toBe(5)
    expect(view.queryByRole('alert')).toBeNull()
    expect(errors).toEqual([])
    // Nothing in the requests could identify the person: the tool name only.
    expect(r.urls.join(' ')).not.toMatch(/email|api_key|@/)
  }, 30_000)

  it('names a service that failed, where its numbers would be and in an alert, and still shows the rest', async () => {
    const r = recording(/idigbio/)
    show(r)
    fireEvent.click(section().getByRole('button', { name: 'List public data' }))
    const view = within(await listed())
    expect(view.getByRole('alert').textContent).toBe('Not every service answered, so these listings are incomplete. A missing count is unknown, not zero:iDigBio: iDigBio answered HTTP 503')
    const idigbio = within(view.getByRole('region', { name: 'iDigBio occurrence counts' }))
    expect(idigbio.getByText("iDigBio didn't answer, so this is unknown, not zero: iDigBio answered HTTP 503")).toBeTruthy()
    expect(idigbio.queryByRole('table')).toBeNull()
    expect(view.getByRole('table', { name: 'GBIF records by country' })).toBeTruthy()
  }, 30_000)

  it('works from the keyboard: native checkboxes and a submit button, in order, and asks only for the sources left ticked', async () => {
    const r = recording()
    show(r)
    const s = section()
    const controls = [...screen.getByRole('region', { name: 'Public data' }).querySelectorAll('input, button, select')] as HTMLElement[]
    expect(controls.map((c) => c.getAttribute('aria-label') ?? (c.closest('label')?.textContent ?? c.textContent)!.trim())).toEqual(['SRA runs (NCBI)', 'Genome assemblies (NCBI Datasets)', 'Occurrence counts (GBIF and iDigBio)', 'Barcode counts (BOLD)', 'List public data'])
    for (const c of controls) expect(c.tabIndex).toBe(0)
    expect(s.getByRole('group', { name: 'Sources' })).toBeTruthy()
    // Space on a focused checkbox is a click; Enter on a focused submit button submits its form.
    for (const name of ['SRA runs (NCBI)', 'Genome assemblies (NCBI Datasets)', 'Occurrence counts (GBIF and iDigBio)']) {
      const box = s.getByRole('checkbox', { name })
      box.focus()
      fireEvent.click(box)
    }
    const button = s.getByRole('button', { name: 'List public data' })
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.submit(button.closest('form')!)
    const view = within(await listed())
    expect(view.getByRole('region', { name: 'BOLD barcode counts' })).toBeTruthy()
    expect(view.queryByRole('region', { name: 'NCBI SRA runs' })).toBeNull()
    expect(r.urls.every((u) => u.includes('boldsystems.org') || u.includes('efetch.fcgi'))).toBe(true)
  }, 30_000)

  it("won't run with no source ticked, and says why", () => {
    show(recording())
    const s = section()
    for (const box of s.getAllByRole('checkbox')) fireEvent.click(box)
    expect((s.getByRole('button', { name: 'List public data' }) as HTMLButtonElement).disabled).toBe(true)
    expect(s.getByText('Pick at least one source.')).toBeTruthy()
  })

  it('says what to do when the profile has no NCBI Taxonomy taxon', () => {
    show(recording(), { ...profile, selection: { ...profile.selection, taxa: [] } })
    expect(section().getByText(/no NCBI Taxonomy taxon yet. Add one in Setup/)).toBeTruthy()
    expect(section().queryByRole('button', { name: 'List public data' })).toBeNull()
  })

  it(`shows ${PUBLIC_ROWS} rows of a long table, and the rest on request from a button`, () => {
    const byCountry = Array.from({ length: PUBLIC_ROWS + 5 }, (_, i) => ({ name: `Country ${i}`, count: 100 - i }))
    const at = '2026-11-11T00:00:00.000Z'
    const listing: PublicListings = { taxon: 'Example taxon', name: 'Example taxon', nameFrom: 'given', asked: ['occurrences'], retrieved: at, sra: null, genomes: null, idigbio: null, bold: null, failed: [{ service: 'iDigBio', message: 'iDigBio answered HTTP 503' }],
      gbif: { source: 'GBIF', retrieved: at, query: 'https://api.gbif.org/v1/occurrence/search?taxonKey=1&limit=0', requests: ['a', 'b'], matched: { name: 'Example taxon' }, total: 2000, byCountry, noCountry: 0, byBasisOfRecord: [], licences: [], notes: [] } }
    render(<PublicListingsView listing={listing} />)
    const rows = () => within(screen.getByRole('table', { name: 'GBIF records by country' })).getAllByRole('rowheader').length
    expect(rows()).toBe(PUBLIC_ROWS)
    const more = screen.getByRole('button', { name: `Show all ${PUBLIC_ROWS + 5} rows of gbif records by country` })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(rows()).toBe(PUBLIC_ROWS + 5)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Retrieved 2026-11-11 00:00:00 UTC, 2 requests.', { exact: false })).toBeTruthy()
  })

  it("asks only hosts on the app's allow-list", async () => {
    const allowed = (JSON.parse(readFileSync(resolve(__dirname, '../src-tauri/capabilities/default.json'), 'utf8')).permissions as ({ identifier?: string; allow?: { url: string }[] } | string)[])
      .flatMap((p) => (typeof p === 'object' && p.identifier === 'http:default' ? p.allow!.map((a) => new RegExp(`^${a.url.replace(/[.?+]/g, '\\$&').replace(/\*/g, '.*')}$`)) : []))
    const r = recording()
    show(r)
    fireEvent.click(section().getByRole('button', { name: 'List public data' }))
    await listed()
    expect(new Set(r.urls.map((u) => new URL(u).host))).toEqual(new Set(['eutils.ncbi.nlm.nih.gov', 'api.ncbi.nlm.nih.gov', 'api.gbif.org', 'search.idigbio.org', 'portal.boldsystems.org']))
    for (const u of r.urls) expect(allowed.some((re) => re.test(u)), u).toBe(true)
    await waitFor(() => expect(errors).toEqual([]))
  }, 30_000)
})
