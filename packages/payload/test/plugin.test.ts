import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { onePhylogeny } from '../src/index.js'

let payload: Payload
let mongo: MongoMemoryReplSet
const admin = { id: 'a1', collection: 'users', role: 'admin' } as never
const viewer = { id: 'v1', collection: 'users', role: 'viewer' } as never
const isAdmin = ({ req }: { req: { user?: unknown } }) => (req.user as { role?: string } | null)?.role === 'admin'
let animal: string | number

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({ config: await buildConfig({
    secret: 'test-secret-not-for-production', telemetry: false, typescript: { autoGenerate: false },
    db: mongooseAdapter({ url: mongo.getUri('onephylogeny'), ensureIndexes: true }),
    collections: [{ slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }] }, { slug: 'animals', fields: [{ name: 'name', type: 'text' }] }],
    plugins: [
      onePhylogeny({ relations: { subject: 'animals' }, manageAccess: isAdmin as never }),
      // A second install, as a site that shows candidates as exploratory would configure it.
      onePhylogeny({ slugs: { panels: 'xpanels', assignments: 'xresults' }, relations: { subject: 'animals' }, manageAccess: isAdmin as never, resultsAgainst: 'activeOrShown' }),
    ],
  }) })
  animal = (await payload.create({ collection: 'animals', data: { name: 'A' } })).id
}, 120000)
afterAll(async () => { await payload?.destroy(); await mongo?.stop() })

let version = 0
const panelData = (over = {}) => ({ key: 'p', version: String(++version), marker: 'gene', checksum: `sha256:${version}`, validatedScope: ['a vs b in w, 100+ columns (exploratory)'], groups: [{ groupId: 'a', label: 'A', regionName: 'North' }, { groupId: 'b', label: 'B' }], ...over })
const createPanel = (over = {}) => payload.create({ collection: 'panels' as never, data: panelData(over) as never }) as unknown as Promise<any>
const activate = (id: unknown) => payload.update({ collection: 'panels' as never, id: id as string, data: { status: 'active' } as never, user: admin }) as unknown as Promise<any>
const resultFor = (p: any, over = {}) => ({ schemaVersion: 2, query: 'q', run: 'r', overlap: 500, caveats: [], pairs: [], candidatesNotEvaluated: ['b'], novelty: { flagged: false, reasons: [], neitherSideSites: 0 }, outOfValidatedScope: [], panel: { id: p.key, version: p.version, checksum: p.checksum },
  findings: [{ group: 'a', status: 'consistent', reasonCode: 'within-spread', reason: 'Close', overlap: 500, informativeSites: 3, windows: [], evidence: ['x'] }, { group: 'b', status: 'not_evaluable', reasonCode: 'too-few-shared-columns', reason: 'No shared sites', overlap: 0, informativeSites: 0, windows: [], evidence: [] }], ...over })
const assign = (p: any, result: unknown = resultFor(p)) => payload.create({ collection: 'assignments' as never, data: { subject: animal, panel: p.id, summary: 'Consistent with A', result } as never }) as unknown as Promise<any>

describe('panels', () => {
  it('start as candidates and refuse coordinates', async () => {
    expect((await createPanel()).status).toBe('candidate')
    await expect(createPanel({ status: 'active' })).rejects.toThrow(/starts as a candidate/)
    await expect(createPanel({ groups: [{ groupId: 'a', label: 'A', lat: 1 }] })).rejects.toThrow()
  })
  it('activating supersedes the previous active panel of that key', async () => {
    const one = await activate((await createPanel({ key: 'k' })).id)
    const two = await activate((await createPanel({ key: 'k' })).id)
    expect(two.status).toBe('active')
    expect(((await payload.findByID({ collection: 'panels' as never, id: one.id })) as any).status).toBe('superseded')
  })
  it('are frozen once active', async () => {
    const p = await activate((await createPanel()).id)
    await expect(payload.update({ collection: 'panels' as never, id: p.id, data: { checksum: 'changed' } as never })).rejects.toThrow(/can't be edited/)
    await expect(payload.update({ collection: 'panels' as never, id: p.id, data: { status: 'candidate' } as never })).rejects.toThrow(/can't go from/)
  })
  it('record who activated them and when', async () => {
    const before = Date.now()
    const p = await activate((await createPanel()).id)
    expect(p.activatedBy).toBe('a1')
    expect(new Date(p.activatedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)
    const c = await createPanel()
    await expect(payload.update({ collection: 'panels' as never, id: c.id, data: { status: 'active' } as never })).rejects.toThrow(/signed-in person/)
    await expect(payload.update({ collection: 'panels' as never, id: c.id, data: { status: 'active' } as never, overrideAccess: false, user: viewer })).rejects.toThrow()
  })
  it('refuse a faked activator or date', async () => {
    await expect(createPanel({ activatedBy: 'someone' })).rejects.toThrow(/set by activating/)
    const c = await createPanel()
    await expect(payload.update({ collection: 'panels' as never, id: c.id, data: { activatedAt: new Date().toISOString() } as never, user: admin })).rejects.toThrow(/set by activating/)
    const p = await activate((await createPanel()).id)
    await expect(payload.update({ collection: 'panels' as never, id: p.id, data: { activatedBy: 'someone' } as never, user: admin })).rejects.toThrow(/set by activating/)
    const withdrawn: any = await payload.update({ collection: 'panels' as never, id: p.id, data: { status: 'withdrawn' } as never, user: admin })
    expect(withdrawn.activatedBy).toBe('a1')
  })
  it('hide candidates from readers and refuse outside writes', async () => {
    const c = await createPanel()
    await expect(payload.findByID({ collection: 'panels' as never, id: c.id, overrideAccess: false, user: viewer })).rejects.toThrow()
    await expect(payload.create({ collection: 'panels' as never, data: panelData() as never, overrideAccess: false, user: viewer })).rejects.toThrow()
  })
})

describe('results', () => {
  it('need an active panel and the exact panel version', async () => {
    const c = await createPanel()
    await expect(assign(c)).rejects.toThrow(/active panel/)
    const p = await activate((await createPanel()).id)
    await expect(assign(p, resultFor({ ...p, version: 'other' }))).rejects.toThrow(/this panel version/)
  })
  it('must report every group, and keep the no-shared-sites rule', async () => {
    const p = await activate((await createPanel()).id)
    const base = resultFor(p)
    await expect(assign(p, { ...base, findings: [base.findings[0]] })).rejects.toThrow(/Missing: b/)
    await expect(assign(p, { ...base, findings: [base.findings[0], { ...base.findings[1], status: 'excluded_within_panel' }] })).rejects.toThrow(/shares no sites/)
  })
  it('are hidden until approved, then released with who and when', async () => {
    const p = await activate((await createPanel()).id)
    const a = await assign(p)
    await expect(payload.findByID({ collection: 'assignments' as never, id: a.id, overrideAccess: false, user: viewer })).rejects.toThrow()
    await expect(payload.update({ collection: 'assignments' as never, id: a.id, data: { reviewStatus: 'approved' } as never, overrideAccess: false, user: viewer })).rejects.toThrow()
    const ok: any = await payload.update({ collection: 'assignments' as never, id: a.id, data: { reviewStatus: 'approved' } as never, overrideAccess: false, user: admin })
    expect(ok.reviewer).toBe('a1')
    expect(ok.releasedAt).toBeTruthy()
    expect(((await payload.findByID({ collection: 'assignments' as never, id: a.id, overrideAccess: false, user: viewer })) as any).reviewStatus).toBe('approved')
  })
  it('stay out of reach for anonymous readers by default', async () => {
    const found = await payload.find({ collection: 'assignments' as never, overrideAccess: false }).catch((e) => e)
    expect(found instanceof Error).toBe(true)
  })
  it('can never be edited, even by a manager, and a new panel never rewrites them', async () => {
    const p = await activate((await createPanel()).id)
    const a = await assign(p)
    await expect(payload.update({ collection: 'assignments' as never, id: a.id, data: { summary: 'Changed' } as never })).rejects.toThrow(/can't be edited/)
    const b = await assign(p)
    await expect(payload.update({ collection: 'assignments' as never, id: b.id, data: { reviewStatus: 'rejected' } as never })).resolves.toBeTruthy()
    await expect(payload.update({ collection: 'assignments' as never, id: b.id, data: { reviewStatus: 'approved' } as never })).rejects.toThrow(/can't go from/)
  })
  it('refuses to fake the reviewer', async () => {
    const p = await activate((await createPanel()).id)
    const a = await assign(p)
    await expect(payload.update({ collection: 'assignments' as never, id: a.id, data: { reviewer: 'someone' } as never, user: admin })).rejects.toThrow(/set by approving/)
  })
})

describe('exploratory candidates', () => {
  const xpanel = (over = {}) => payload.create({ collection: 'xpanels' as never, data: panelData(over) as never }) as unknown as Promise<any>
  const xupdate = (id: unknown, data: object) => payload.update({ collection: 'xpanels' as never, id: id as string, data: data as never, user: admin }) as unknown as Promise<any>
  const xassign = (p: any) => payload.create({ collection: 'xresults' as never, data: { subject: animal, panel: p.id, summary: 'S', result: resultFor(p) } as never }) as unknown as Promise<any>

  it('are refused by default, even when shown', async () => {
    const p = await createPanel()
    const shown = await payload.update({ collection: 'panels' as never, id: p.id, data: { shownAsExploratory: true } as never, user: admin }) as any
    expect(shown.shownAsExploratory).toBe(true)
    await expect(assign(shown)).rejects.toThrow(/active panel/)
  })
  it('take results only once shown, and stamp what the result was made against', async () => {
    const p = await xpanel()
    await expect(xassign(p)).rejects.toThrow(/shown as exploratory/)
    const shown = await xupdate(p.id, { shownAsExploratory: true })
    const r = await xassign(shown)
    expect(r).toMatchObject({ panelStatus: 'candidate', panelShownAsExploratory: true })
    const active = await xupdate(p.id, { status: 'active' })
    expect(active.shownAsExploratory).toBe(false)
    expect(((await payload.findByID({ collection: 'xresults' as never, id: r.id })) as any).panelStatus).toBe('candidate')
    expect(await xassign(active)).toMatchObject({ panelStatus: 'active', panelShownAsExploratory: false })
  })
  it('keep the stamp fixed, and the flag on candidates only', async () => {
    const shown = await xupdate((await xpanel()).id, { shownAsExploratory: true })
    const r = await xassign(shown)
    await expect(payload.update({ collection: 'xresults' as never, id: r.id, data: { panelStatus: 'active' } as never, user: admin })).rejects.toThrow(/set when it is made/)
    const active = await xupdate((await xpanel()).id, { status: 'active' })
    await expect(xupdate(active.id, { shownAsExploratory: true })).rejects.toThrow(/Only a candidate/)
    const withdrawn = await xupdate(shown.id, { status: 'withdrawn' })
    expect(withdrawn.shownAsExploratory).toBe(false)
  })
  it('let readers see shown candidates only where the site allows them', async () => {
    const hidden = await xpanel()
    const shown = await xupdate((await xpanel()).id, { shownAsExploratory: true })
    await expect(payload.findByID({ collection: 'xpanels' as never, id: shown.id, overrideAccess: false, user: viewer })).resolves.toBeTruthy()
    await expect(payload.findByID({ collection: 'xpanels' as never, id: hidden.id, overrideAccess: false, user: viewer })).rejects.toThrow()
    const plain = await payload.update({ collection: 'panels' as never, id: (await createPanel()).id, data: { shownAsExploratory: true } as never, user: admin }) as any
    await expect(payload.findByID({ collection: 'panels' as never, id: plain.id, overrideAccess: false, user: viewer })).rejects.toThrow()
  })
})

describe('released endpoint', () => {
  const call = (subject: string | null, user: unknown) => {
    const endpoint = (payload.config.endpoints as { path: string; handler: (r: unknown) => Promise<Response> }[]).find((e) => e.path === '/onephylogeny/released')!
    return endpoint.handler({ url: `http://x/api/onephylogeny/released${subject ? `?subject=${subject}` : ''}`, payload, user })
  }
  it('returns only approved results, with the caller\'s permissions', async () => {
    const other = (await payload.create({ collection: 'animals', data: { name: 'B' } })).id
    const p = await activate((await createPanel()).id)
    const make = () => payload.create({ collection: 'assignments' as never, data: { subject: other, panel: p.id, summary: 'S', result: resultFor(p) } as never }) as unknown as Promise<any>
    const hidden = await make()
    const shown = await make()
    await payload.update({ collection: 'assignments' as never, id: shown.id, data: { reviewStatus: 'approved' } as never, user: admin })
    const body = await (await call(String(other), viewer)).json()
    expect(body.docs.map((d: { id: unknown }) => d.id)).toEqual([shown.id])
    expect(body.docs.map((d: { id: unknown }) => d.id)).not.toContain(hidden.id)
  })
  it('needs a subject', async () => {
    expect((await call(null, viewer)).status).toBe(400)
  })
})
