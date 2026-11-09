import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { either, onePhylogeny } from '../src/index.js'

/** Reviewers limited to their own site, as a multi-site host sets them up. */
let payload: Payload
let mongo: MongoMemoryReplSet
type U = { id: string; role: string; site?: string }
const user = (u: U) => ({ ...u, collection: 'users' }) as never
const admin = user({ id: 'a1', role: 'admin' })
const reviewerA = user({ id: 'g1', role: 'genealogist', site: 'A' })
const memberA = user({ id: 'm1', role: 'member', site: 'A' })
const me = (req: { user?: unknown }) => req.user as U | null
let panel: any
let animal: string

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({ config: await buildConfig({
    secret: 'test-secret-not-for-production', telemetry: false, typescript: { autoGenerate: false },
    db: mongooseAdapter({ url: mongo.getUri('review'), ensureIndexes: true }),
    collections: [{ slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }, { name: 'site', type: 'text' }] }, { slug: 'animals', access: { read: ({ req }: any) => me(req)?.role === 'admin' }, fields: [{ name: 'name', type: 'text' }] }],
    plugins: [
      onePhylogeny({
        relations: { subject: 'animals' },
        manageAccess: (({ req }: any) => me(req)?.role === 'admin') as never,
        reviewAccess: (({ req }: any) => (me(req)?.role === 'admin' ? true : me(req)?.role === 'genealogist' ? { site: { equals: me(req)!.site } } : false)) as never,
        readReleasedAccess: (({ req }: any) => (me(req) ? { site: { equals: me(req)!.site } } : false)) as never,
        tenantField: 'site',
      }),
      (config) => ({ ...config, collections: config.collections!.map((c) => (c.slug === 'assignments' ? { ...c, fields: [...c.fields, { name: 'site', type: 'text' }] } : c)) }),
    ],
  }) })
  animal = String((await payload.create({ collection: 'animals', data: { name: 'Made-up' } })).id)
  const p = await payload.create({ collection: 'panels' as never, data: { key: 'p', version: '1', marker: 'cytb', checksum: 'sha256:1', validatedScope: ['a vs b'], groups: [{ groupId: 'a', label: 'A' }] } as never })
  panel = await payload.update({ collection: 'panels' as never, id: (p as any).id, data: { status: 'active' } as never, user: admin })
}, 120000)
afterAll(async () => { await payload?.destroy(); await mongo?.stop() })

const resultFor = () => ({ schemaVersion: 2, query: 'q', run: 'r', overlap: 500, caveats: [], pairs: [], candidatesNotEvaluated: [], novelty: { flagged: false, reasons: [], neitherSideSites: 0 }, outOfValidatedScope: [], panel: { id: 'p', version: '1', checksum: 'sha256:1' },
  findings: [{ group: 'a', status: 'consistent', reasonCode: 'within-spread', reason: 'Close', overlap: 500, informativeSites: 3, windows: [], evidence: ['x'] }] })
const pendingOn = async (site: string) => payload.create({ collection: 'assignments' as never, data: { subject: animal, panel: panel.id, summary: 'Consistent with A', result: resultFor(), site } as never }) as unknown as Promise<any>
const sees = async (u: unknown, id: string) => (await payload.find({ collection: 'assignments' as never, where: { id: { equals: id } } as never, user: u as never, overrideAccess: false })).docs.length === 1
const approve = (u: unknown, id: string) => payload.update({ collection: 'assignments' as never, id, data: { reviewStatus: 'approved' } as never, user: u as never, overrideAccess: false }) as unknown as Promise<any>

describe('either', () => {
  it('never reads a query as everything', () => {
    expect(either(false, { site: { equals: 'A' } })).toEqual({ site: { equals: 'A' } })
    expect(either({ a: { equals: 1 } }, { b: { equals: 2 } })).toEqual({ or: [{ a: { equals: 1 } }, { b: { equals: 2 } }] })
    expect(either(false, null, undefined)).toBe(false)
    expect(either({ a: { equals: 1 } }, true)).toBe(true)
  })
})

describe('reviewers of one site', () => {
  it('see and approve that site\'s pending results, and nothing of another site', async () => {
    const onA = await pendingOn('A')
    const onB = await pendingOn('B')
    expect(await sees(reviewerA, onA.id)).toBe(true)
    expect(await sees(reviewerA, onB.id)).toBe(false)
    await expect(approve(reviewerA, onB.id)).rejects.toThrow()
    const done = await approve(reviewerA, onA.id)
    expect(done).toMatchObject({ reviewStatus: 'approved', reviewer: 'g1' })
    expect(((await payload.findByID({ collection: 'assignments' as never, id: onB.id })) as any).reviewStatus).toBe('pending')
  })
  it('are the only ones besides maintainers who can approve; members see results only once released', async () => {
    const onA = await pendingOn('A')
    expect(await sees(memberA, onA.id)).toBe(false)
    await expect(approve(memberA, onA.id)).rejects.toThrow()
    await approve(admin, onA.id)
    expect(await sees(memberA, onA.id)).toBe(true)
  })
  it('can\'t move a result to another site, before or after approving it', async () => {
    const onA = await pendingOn('A')
    await expect(approve(reviewerA, onA.id).then(() => payload.update({ collection: 'assignments' as never, id: onA.id, data: { site: 'B' } as never, user: reviewerA, overrideAccess: false }))).rejects.toThrow(/stays on the site/)
    const other = await pendingOn('A')
    await expect(payload.update({ collection: 'assignments' as never, id: other.id, data: { site: 'B' } as never, user: admin })).rejects.toThrow(/stays on the site/)
    expect(((await payload.findByID({ collection: 'assignments' as never, id: onA.id })) as any).site).toBe('A')
  })
  it('can\'t make results; only maintainers and the sweep can', async () => {
    await expect(payload.create({ collection: 'assignments' as never, data: { subject: animal, panel: panel.id, summary: 'S', result: resultFor(), site: 'A' } as never, user: reviewerA, overrideAccess: false })).rejects.toThrow()
  })
  it('approving in bulk reaches only their own site', async () => {
    const onA = await pendingOn('A')
    const onB = await pendingOn('B')
    await payload.update({ collection: 'assignments' as never, where: { id: { in: [onA.id, onB.id] } } as never, data: { reviewStatus: 'approved' } as never, user: reviewerA, overrideAccess: false })
    expect(((await payload.findByID({ collection: 'assignments' as never, id: onA.id })) as any).reviewStatus).toBe('approved')
    expect(((await payload.findByID({ collection: 'assignments' as never, id: onB.id })) as any).reviewStatus).toBe('pending')
  })
})
