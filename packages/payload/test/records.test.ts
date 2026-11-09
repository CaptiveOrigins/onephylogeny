import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { sha256Hex, type Result } from '@captiveorigins/onephylogeny-core'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assignWaiting, onePhylogeny, readSingleSequence, registerSequence, type Evaluate } from '../src/index.js'

let payload: Payload
let mongo: MongoMemoryReplSet
const admin = { id: 'a1', collection: 'users', role: 'admin' } as never
const viewer = { id: 'v1', collection: 'users', role: 'viewer' } as never
const staffOf = (site: string) => ({ id: `s-${site}`, collection: 'users', role: 'staff', site }) as never
const isAdmin = ({ req }: { req: { user?: unknown } }) => (req.user as { role?: string } | null)?.role === 'admin'
let taxon: string, otherTaxon: string, animal: string, bare: string, lab: string

const BASES = 'ATGACCAACATCCGAAAATCACACCCACTAATAAAAATTATCAACAACGCATTCATTGACCTCCCAGCCCCATCAAACATCTCATCATGATGAAACTTTGGATCCCTCCTAGGAATTTGCC'
const fasta = (body = BASES, id = 'K0001') => `>${id} cytb\n${body.slice(0, 60)}\n${body.slice(60)}\n`
const kitOf = async () => String((await payload.create({ collection: 'kits' as never, data: { code: String(Math.random()) } as never })).id)
const register = async (over: Record<string, unknown> = {}) => {
  const text = (over.text as string | undefined) ?? fasta()
  return registerSequence(payload, { tenant: 'site-1', animal, kit: await kitOf(), lab, sha256: sha256Hex(text), text, marker: 'cytb', ...over } as never)
}

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({ config: await buildConfig({
    secret: 'test-secret-not-for-production', telemetry: false, typescript: { autoGenerate: false },
    db: mongooseAdapter({ url: mongo.getUri('records'), ensureIndexes: true }),
    collections: [
      { slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }] },
      { slug: 'taxa', fields: [{ name: 'name', type: 'text' }] },
      { slug: 'animals', fields: [{ name: 'name', type: 'text' }, { name: 'taxon', type: 'relationship', relationTo: 'taxa' }] },
      { slug: 'kits', fields: [{ name: 'code', type: 'text' }] },
      { slug: 'labs', fields: [{ name: 'name', type: 'text' }] },
    ],
    plugins: [
      onePhylogeny({ relations: { subject: 'animals', taxa: 'taxa' }, manageAccess: isAdmin as never, resultsAgainst: 'activeOrShown', records: { relations: { kit: 'kits', lab: 'labs' }, readAccess: (({ req }: any) => (req.user?.site ? { tenant: { equals: req.user.site } } : false)) as never, markers: { cytb: { minLength: 100, maxLength: 1200 } } } }),
      // A host's tenant field, as a multi-tenant plugin would add it.
      (config) => ({ ...config, collections: config.collections!.map((c) => ['samples', 'sequences', 'assignments'].includes(c.slug) ? { ...c, fields: [...c.fields, { name: 'tenant', type: 'text' }] } : c) }),
    ],
  }) })
  taxon = String((await payload.create({ collection: 'taxa' as never, data: { name: 'Redfoot' } as never })).id)
  otherTaxon = String((await payload.create({ collection: 'taxa' as never, data: { name: 'Yellowfoot' } as never })).id)
  animal = String((await payload.create({ collection: 'animals' as never, data: { name: 'Made-up tortoise', taxon } as never })).id)
  bare = String((await payload.create({ collection: 'animals' as never, data: { name: 'No species' } as never })).id)
  lab = String((await payload.create({ collection: 'labs' as never, data: { name: 'Made-up lab' } as never })).id)
}, 120000)
afterAll(async () => { await payload?.destroy(); await mongo?.stop() })

describe('reading a lab file', () => {
  it('takes one DNA sequence and cleans it', () => {
    expect(readSingleSequence(fasta(BASES.toLowerCase().replace('acc', 'a-cc')), 'cytb')).toEqual({ recordId: 'K0001', residues: BASES.replace('ACC', 'ACC') })
  })
  it('refuses, in plain words, files that are not one usable sequence', () => {
    expect(() => readSingleSequence(fasta() + fasta(BASES, 'K0002'), 'cytb')).toThrow(/holds 2 sequences/)
    expect(() => readSingleSequence('', 'cytb')).toThrow(/empty/)
    expect(() => readSingleSequence(BASES, 'cytb')).toThrow(/before the first ">"/)
    expect(() => readSingleSequence(fasta(BASES.replace('ATG', 'AJZ')), 'cytb')).toThrow(/aren't DNA bases: J Z/)
    expect(() => readSingleSequence(fasta('ACGT'), 'cytb')).toThrow(/4 bases long, shorter than the 100/)
    expect(() => readSingleSequence(fasta('N'.repeat(80) + BASES.slice(0, 60)), 'cytb')).toThrow(/More than half/)
    expect(() => readSingleSequence(fasta(), 'coi', { cytb: {} })).toThrow(/doesn't test the marker "coi"/)
  })
})

describe('registerSequence', () => {
  it('records a sample and a sequence, with the species taken from the animal', async () => {
    const { sample, sequence, created } = await register()
    expect(created).toBe(true)
    expect(sample).toMatchObject({ subject: animal, taxon, source: 'kit', tenant: 'site-1' })
    expect(sequence).toMatchObject({ sample: sample.id, marker: 'cytb', lab, status: 'received', length: BASES.length, recordId: 'K0001', tenant: 'site-1' })
  })
  it('changes nothing when the same file comes again, and adds a re-run as a second sequence on the same sample', async () => {
    const kit = await kitOf()
    const first = await register({ kit })
    const again = await register({ kit })
    expect(again.created).toBe(false)
    expect(again.sequence.id).toBe(first.sequence.id)
    const rerun = await register({ kit, text: fasta(BASES.replace('ATG', 'ATA')) })
    expect(rerun.created).toBe(true)
    expect(rerun.sample.id).toBe(first.sample.id)
  })
  it('refuses a file whose text does not match its checksum', async () => {
    await expect(register({ sha256: sha256Hex('something else') })).rejects.toThrow(/doesn't match its SHA-256/)
    await expect(register({ sha256: 'abc' })).rejects.toThrow(/malformed/)
  })
  it('refuses a kit with no animal, an animal with no species, and a kit already used for another animal', async () => {
    await expect(register({ animal: '' })).rejects.toThrow(/activated first/)
    await expect(register({ animal: bare })).rejects.toThrow(/no species recorded/)
    const kit = await kitOf()
    await register({ kit })
    const other = String((await payload.create({ collection: 'animals' as never, data: { name: 'Other', taxon } as never })).id)
    await expect(register({ kit, animal: other })).rejects.toThrow(/another animal/)
  })
  it('keeps samples and sequences private and unchangeable', async () => {
    const { sample, sequence } = await register()
    await expect(payload.find({ collection: 'sequences' as never, user: viewer, overrideAccess: false })).rejects.toThrow(/not allowed/)
    await expect(payload.update({ collection: 'sequences' as never, id: sequence.id as never, data: { residues: 'ACGT' } as never })).rejects.toThrow(/can't be edited/)
    await expect(payload.update({ collection: 'samples' as never, id: sample.id as never, data: { subject: bare } as never })).rejects.toThrow(/can't change/)
    await expect(payload.delete({ collection: 'sequences' as never, id: sequence.id as never, user: admin, overrideAccess: false })).rejects.toThrow()
  })
  it('shows a site\'s staff only that site\'s samples and sequences, and none can be moved to another site', async () => {
    const { sample, sequence } = await register({ tenant: 'site-2' })
    const seen = async (u: unknown, collection: string, id: unknown) => (await payload.find({ collection: collection as never, where: { id: { equals: id } } as never, user: u as never, overrideAccess: false })).docs.length
    expect(await seen(staffOf('site-2'), 'sequences', sequence.id)).toBe(1)
    expect(await seen(staffOf('site-2'), 'samples', sample.id)).toBe(1)
    expect(await seen(staffOf('site-1'), 'sequences', sequence.id)).toBe(0)
    expect(await seen(staffOf('site-1'), 'samples', sample.id)).toBe(0)
    await expect(payload.update({ collection: 'sequences' as never, id: sequence.id as never, data: { status: 'assigned' } as never, user: staffOf('site-2'), overrideAccess: false })).rejects.toThrow()
    await expect(payload.update({ collection: 'sequences' as never, id: sequence.id as never, data: { tenant: 'site-1' } as never })).rejects.toThrow(/can't be edited/)
    await expect(payload.update({ collection: 'samples' as never, id: sample.id as never, data: { tenant: 'site-1' } as never })).rejects.toThrow(/can't change/)
  })
})

describe('assignWaiting', () => {
  let n = 0
  const panelFor = async (over: Record<string, unknown> = {}) => {
    const p = await payload.create({ collection: 'panels' as never, data: { key: 'redfoot', version: `0.${++n}`, marker: 'cytb', checksum: `sha256:${n}`, taxa: [taxon], validatedScope: ['a vs b'], groups: [{ groupId: 'a', label: 'North' }, { groupId: 'b', label: 'South' }], ...over } as never }) as unknown as Record<string, unknown>
    return p
  }
  const resultFor = (p: Record<string, unknown>, query: string): Result => ({ schemaVersion: 2, query, run: 'r', overlap: 120, caveats: [], pairs: [], candidatesNotEvaluated: ['b'], novelty: { flagged: false, reasons: [], neitherSideSites: 0 }, outOfValidatedScope: [], panel: { id: String(p.key), version: String(p.version), checksum: String(p.checksum) },
    findings: [{ group: 'a', status: 'consistent', reasonCode: 'within-spread', reason: 'Close', overlap: 120, informativeSites: 3, windows: [], evidence: ['x'] }, { group: 'b', status: 'not_evaluable', reasonCode: 'too-few-shared-columns', reason: 'No shared sites', overlap: 0, informativeSites: 0, windows: [], evidence: [] }] } as unknown as Result)
  const clear = async () => { await payload.update({ collection: 'sequences' as never, where: { status: { equals: 'received' } } as never, data: { status: 'not-assessable', statusReason: 'cleared by the test' } as never }) }

  it('leaves a sequence waiting while no panel fits its species', async () => {
    await clear()
    await panelFor({ taxa: [otherTaxon], shownAsExploratory: true })
    await register()
    const evaluate: Evaluate = async () => { throw new Error('should not run') }
    expect(await assignWaiting(payload, { evaluate })).toMatchObject({ noPanel: 1, assigned: 0 })
  })
  it('makes a pending result against a shown candidate, stamped exploratory, on the site of the sample', async () => {
    await clear()
    const panel = await panelFor({ shownAsExploratory: true })
    const { sequence } = await register()
    const evaluate: Evaluate = async ({ queryId, panel: p }) => ({ result: resultFor(p, queryId), problems: [] })
    expect(await assignWaiting(payload, { evaluate })).toMatchObject({ assigned: 1, checked: 1 })
    const made = (await payload.find({ collection: 'assignments' as never, where: { sequence: { equals: sequence.id } } as never, depth: 0 })).docs[0] as Record<string, unknown>
    expect(made).toMatchObject({ subject: animal, panel: panel.id, reviewStatus: 'pending', summary: 'Consistent with North', panelStatus: 'candidate', panelShownAsExploratory: true, tenant: 'site-1' })
    expect(((await payload.findByID({ collection: 'sequences' as never, id: sequence.id as never })) as unknown as Record<string, unknown>).status).toBe('assigned')
    // Readers see nothing until a reviewer approves it.
    expect((await payload.find({ collection: 'assignments' as never, where: { sequence: { equals: sequence.id } } as never, user: viewer, overrideAccess: false })).docs).toHaveLength(0)
    await payload.update({ collection: 'assignments' as never, id: made.id as never, data: { reviewStatus: 'approved' } as never, user: admin })
    expect((await payload.find({ collection: 'assignments' as never, where: { sequence: { equals: sequence.id } } as never, user: viewer, overrideAccess: false })).docs).toHaveLength(1)
  })
  it('marks a sequence the checks refuse as not assessable, with the reason', async () => {
    await clear()
    await panelFor({ shownAsExploratory: true })
    const { sequence } = await register()
    const evaluate: Evaluate = async () => ({ result: null, problems: ['Only 40% of the sequence aligned to the reference'] })
    expect(await assignWaiting(payload, { evaluate })).toMatchObject({ notAssessable: 1 })
    expect(await payload.findByID({ collection: 'sequences' as never, id: sequence.id as never })).toMatchObject({ status: 'not-assessable', statusReason: 'Only 40% of the sequence aligned to the reference' })
  })
})
