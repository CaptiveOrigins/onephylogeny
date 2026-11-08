import { parseFasta, sha256Hex, type Result } from '@captiveorigins/onephylogeny-core'
import { APIError, type Access, type CollectionBeforeChangeHook, type CollectionConfig, type Field, type Payload, type PayloadRequest, type Where } from 'payload'

/** Settings for the optional `samples` and `sequences` collections. */
export type RecordsOptions = {
  slugs?: { samples?: string; sequences?: string }
  /** Host collections for the kit a sample came in and the lab that read it. Left out, the field isn't added. */
  relations?: { kit?: string; lab?: string }
  /** Who may read samples and sequences, besides managers. Default: managers only. */
  readAccess?: Access
  /** The markers a sequence may be for, with the lengths accepted. Default: any marker, 100 to 50,000 bases. */
  markers?: Record<string, { minLength?: number; maxLength?: number }>
  /** The host's tenant field, filled from `registerSequence`'s `tenant` and copied onto results. Default `tenant`. */
  tenantField?: string
}

export type RecordsConfig = {
  samples: string
  sequences: string
  panels: string
  assignments: string
  tenantField: string
  markers: RecordsOptions['markers']
  subject?: string
  hasTaxa: boolean
  hasKit: boolean
  hasLab: boolean
  hasFiles: boolean
  againstShown: boolean
}

const CUSTOM_KEY = 'onePhylogenyRecords'
const DNA = /^[ACGTRYKMSWBDHVN]+$/
const DEFAULT_LENGTH = { minLength: 100, maxLength: 50000 }

const fail = (message: string): never => { throw new APIError(message, 400, undefined, true) }
const idOf = (v: unknown) => (v && typeof v === 'object' ? String((v as { id: unknown }).id) : v == null ? undefined : String(v))
const relation = (name: string, relationTo: string | undefined, extra: Partial<Field> = {}): Field[] =>
  relationTo ? [{ name, type: 'relationship', relationTo, index: true, ...extra } as Field] : []

const locked = (fields: string[], message: string): CollectionBeforeChangeHook => ({ data, originalDoc, operation }) => {
  if (operation === 'update') for (const f of fields) if (f in data && JSON.stringify(idOf(data[f]) ?? data[f] ?? null) !== JSON.stringify(idOf(originalDoc[f]) ?? originalDoc[f] ?? null)) fail(message)
  return data
}

export function recordCollections(o: RecordsOptions, base: { panels: string; assignments: string; subject?: string; taxa?: string; files?: string; manage: Access; againstShown: boolean }) {
  const samples = o.slugs?.samples ?? 'samples'
  const sequences = o.slugs?.sequences ?? 'sequences'
  const manage = base.manage
  const read: Access = async (args) => (await manage(args)) || (o.readAccess ? o.readAccess(args) : false)
  const access = { read, create: manage, update: manage, delete: () => false }

  const sampleCollection: CollectionConfig = {
    slug: samples,
    labels: { singular: 'Sample', plural: 'Samples' },
    admin: { group: 'Genetics', defaultColumns: ['subject', 'source', 'kit', 'createdAt'] },
    access,
    fields: [
      ...relation('subject', base.subject, { required: true }),
      ...relation('kit', o.relations?.kit),
      ...relation('taxon', base.taxa),
      { name: 'source', type: 'select', required: true, defaultValue: 'kit', options: ['kit', 'upload', 'historic'] },
      { name: 'material', type: 'text', admin: { description: 'What was sampled, such as a shell scrape or blood.' } },
      { name: 'collectedAt', type: 'date' },
      { name: 'consent', type: 'text', admin: { description: 'The keeper\'s consent, as recorded with the kit or upload.' } },
    ],
    hooks: { beforeChange: [locked(['subject', 'kit', 'source'], 'A sample\'s animal, kit and source can\'t change. Record a new sample instead.')] },
  }

  const sequenceCollection: CollectionConfig = {
    slug: sequences,
    labels: { singular: 'Sequence', plural: 'Sequences' },
    admin: { group: 'Genetics', useAsTitle: 'recordId', defaultColumns: ['recordId', 'marker', 'status', 'length', 'createdAt'] },
    access,
    fields: [
      { name: 'sample', type: 'relationship', relationTo: samples, required: true, index: true },
      { name: 'marker', type: 'text', required: true, index: true },
      ...relation('lab', o.relations?.lab),
      ...relation('file', base.files, { admin: { description: 'The file the lab sent. It stays the record of what was received.' } } as Partial<Field>),
      { name: 'sha256', type: 'text', required: true, index: true, admin: { description: 'SHA-256 of the file, checked against its text when it was registered.' } },
      { name: 'recordId', type: 'text', admin: { description: 'The FASTA header the lab gave this sequence.' } },
      { name: 'residues', type: 'textarea', required: true, admin: { description: 'The bases, cleaned of gaps and line breaks. Used for analysis.' } },
      { name: 'length', type: 'number', required: true },
      { name: 'status', type: 'select', required: true, defaultValue: 'received', index: true, options: ['received', 'assigned', 'not-assessable'] },
      { name: 'statusReason', type: 'text', admin: { description: 'Why it couldn\'t be assessed, in plain words.' } },
    ],
    hooks: { beforeChange: [locked(['sample', 'marker', 'file', 'sha256', 'residues', 'recordId', 'length'], 'A sequence can\'t be edited. Register the corrected file instead.')] },
  }

  const config: RecordsConfig = {
    samples, sequences, panels: base.panels, assignments: base.assignments, tenantField: o.tenantField ?? 'tenant', markers: o.markers,
    subject: base.subject, hasTaxa: Boolean(base.taxa), hasKit: Boolean(o.relations?.kit), hasLab: Boolean(o.relations?.lab), hasFiles: Boolean(base.files), againstShown: base.againstShown,
  }
  return { collections: [sampleCollection, sequenceCollection], config, customKey: CUSTOM_KEY }
}

const configOf = (payload: Payload): RecordsConfig => {
  const c = (payload.config.custom as Record<string, unknown> | undefined)?.[CUSTOM_KEY] as RecordsConfig | undefined
  if (!c) throw new Error('OnePhylogeny samples and sequences aren\'t turned on. Pass `records` to the plugin.')
  return c
}

/** Reads one FASTA file as one sequence, or says in plain words why it can't. */
export function readSingleSequence(text: string, marker: string, markers?: RecordsOptions['markers']): { recordId: string; residues: string } {
  if (markers && !markers[marker]) fail(`This site doesn't test the marker "${marker}".`)
  const { minLength, maxLength } = { ...DEFAULT_LENGTH, ...markers?.[marker] }
  let entries
  try { entries = parseFasta(text.replace(/^﻿/, '')) } catch { return fail('This file isn\'t FASTA: it has bases before the first ">" header line.') }
  if (!entries.length) fail('This file is empty or has no ">" header line, so it isn\'t FASTA.')
  if (entries.length > 1) fail(`This file holds ${entries.length} sequences. Send one file per kit, with one sequence in it.`)
  const entry = entries[0]!
  const residues = entry.sequence.replace(/[\s\-.]/g, '').toUpperCase()
  if (!residues) fail('This file\'s sequence is empty.')
  if (!DNA.test(residues)) {
    const bad = [...new Set(residues.replace(/[ACGTRYKMSWBDHVN]/g, ''))].slice(0, 5).join(' ')
    fail(`This sequence has characters that aren't DNA bases: ${bad}.`)
  }
  if (residues.length < minLength!) fail(`This sequence is ${residues.length} bases long, shorter than the ${minLength} needed for ${marker}.`)
  if (residues.length > maxLength!) fail(`This sequence is ${residues.length} bases long, longer than the ${maxLength} expected for ${marker}.`)
  const unresolved = (residues.match(/[^ACGT]/g) ?? []).length
  if (unresolved > residues.length / 2) fail(`More than half of this sequence's bases are unresolved (${unresolved} of ${residues.length}).`)
  return { recordId: entry.id, residues }
}

export type RegisterSequenceInput = {
  /** The host's tenant (site), written to the tenant field. */
  tenant?: string | number
  animal: string | number
  /** Taken from the animal's `taxon` field when left out. */
  taxon?: string | number
  kit?: string | number
  lab?: string | number
  /** The host's file record holding the bytes the lab sent. */
  file?: string | number
  /** SHA-256 of the file, as the host computed it from the stored bytes. */
  sha256: string
  /** The file's text. It must hash to `sha256`. */
  text: string
  marker: string
  source?: 'kit' | 'upload' | 'historic'
  collectedAt?: string
  req?: PayloadRequest
}

/**
 * Records one lab file as a sample and a sequence. It writes with full access, so the caller must already have checked
 * that this person may submit results for this kit. Calling it again with the same kit and file changes nothing.
 */
export async function registerSequence(payload: Payload, input: RegisterSequenceInput): Promise<{ sample: Record<string, unknown>; sequence: Record<string, unknown>; created: boolean }> {
  const c = configOf(payload)
  const opts = { req: input.req, overrideAccess: true, depth: 0 } as const
  const sha256 = input.sha256.replace(/^sha256:/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail('The file\'s SHA-256 is missing or malformed.')
  if (sha256Hex(input.text) !== sha256) fail('This file\'s text doesn\'t match its SHA-256. It may have changed after upload; upload it again.')
  if ((input.source ?? 'kit') === 'kit' && input.kit == null) fail('A kit sample needs its kit.')
  if (input.animal == null || input.animal === '') fail('This kit isn\'t linked to an animal yet. It has to be activated first.')
  const { recordId, residues } = readSingleSequence(input.text, input.marker, c.markers)

  let taxon = input.taxon
  if (taxon == null && c.hasTaxa) {
    const subject = c.subject ? await payload.findByID({ collection: c.subject as never, id: input.animal as never, ...opts }).catch(() => null) as Record<string, unknown> | null : null
    taxon = idOf(subject?.taxon)
  }
  if (c.hasTaxa && taxon == null) fail('This animal has no species recorded, so its sequence can\'t be matched to a panel.')

  // One sample per kit; uploads and historic records get one per call.
  let sample: Record<string, unknown> | undefined
  if (input.kit != null && c.hasKit) {
    sample = (await payload.find({ collection: c.samples as never, where: { kit: { equals: input.kit } } as Where, limit: 1, ...opts })).docs[0] as Record<string, unknown> | undefined
    if (sample && idOf(sample.subject) !== String(input.animal)) fail('This kit is already recorded for another animal.')
  }
  if (sample) {
    const existing = (await payload.find({ collection: c.sequences as never, where: { and: [{ sample: { equals: sample.id } }, { sha256: { equals: sha256 } }] } as Where, limit: 1, ...opts })).docs[0] as Record<string, unknown> | undefined
    if (existing) return { sample, sequence: existing, created: false }
  } else {
    sample = await payload.create({ collection: c.samples as never, data: {
      ...(c.subject ? { subject: input.animal } : {}), ...(c.hasKit && input.kit != null ? { kit: input.kit } : {}), ...(c.hasTaxa ? { taxon } : {}),
      source: input.source ?? 'kit', ...(input.collectedAt ? { collectedAt: input.collectedAt } : {}), ...(input.tenant != null ? { [c.tenantField]: input.tenant } : {}),
    } as never, ...opts }) as unknown as Record<string, unknown>
  }
  const sequence = await payload.create({ collection: c.sequences as never, data: {
    sample: sample.id, marker: input.marker, sha256, recordId, residues, length: residues.length, status: 'received',
    ...(c.hasLab && input.lab != null ? { lab: input.lab } : {}), ...(c.hasFiles && input.file != null ? { file: input.file } : {}), ...(input.tenant != null ? { [c.tenantField]: input.tenant } : {}),
  } as never, ...opts }) as unknown as Record<string, unknown>
  return { sample, sequence, created: true }
}

/** What `assignWaiting` asks the host to compute for one sequence against one panel. */
export type Evaluate = (args: { residues: string; queryId: string; panel: Record<string, unknown> }) => Promise<{ result: Result | null; problems: string[] }>

/** A short, plain summary of a result, naming the groups it is consistent with. */
export function summarize(result: Result, panel: { groups?: { groupId: string; label: string }[] }): string {
  const label = (id: string) => panel.groups?.find((g) => g.groupId === id)?.label ?? id
  const consistent = result.findings.filter((f) => f.status === 'consistent').map((f) => label(f.group))
  if (consistent.length === 1) return `Consistent with ${consistent[0]}`
  if (consistent.length > 1) return `Consistent with ${consistent.slice(0, -1).join(', ')} or ${consistent.at(-1)}`
  return 'No single lineage'
}

/**
 * The sweep: tests each sequence still `received` against the panel for its marker and species, and records a result
 * waiting for review. A sequence with no panel stays waiting; one the checks refuse is marked not assessable, with why.
 */
export async function assignWaiting(payload: Payload, args: { evaluate: Evaluate; limit?: number; req?: PayloadRequest }) {
  const c = configOf(payload)
  const opts = { req: args.req, overrideAccess: true, depth: 0 } as const
  const tally = { assigned: 0, notAssessable: 0, noPanel: 0 }
  const waiting = await payload.find({ collection: c.sequences as never, where: { status: { equals: 'received' } } as Where, sort: 'createdAt', limit: args.limit ?? 200, ...opts })
  const usable: Where = c.againstShown
    ? { or: [{ status: { equals: 'active' } }, { and: [{ status: { equals: 'candidate' } }, { shownAsExploratory: { equals: true } }] }] }
    : { status: { equals: 'active' } }
  for (const seq of waiting.docs as Record<string, unknown>[]) {
    const sample = await payload.findByID({ collection: c.samples as never, id: idOf(seq.sample) as never, ...opts }) as unknown as Record<string, unknown>
    const taxon = idOf(sample.taxon)
    const found = await payload.find({ collection: c.panels as never, where: { and: [{ marker: { equals: seq.marker } }, usable] } as Where, sort: '-createdAt', limit: 50, ...opts })
    // An active panel wins over a shown candidate; within each, the newest.
    const fits = (found.docs as Record<string, unknown>[]).filter((p) => !c.hasTaxa || !(p.taxa as unknown[] | undefined)?.length || (p.taxa as unknown[]).map(idOf).includes(taxon))
    const panel = fits.find((p) => p.status === 'active') ?? fits[0]
    if (!panel) { tally.noPanel++; continue }
    const already = await payload.find({ collection: c.assignments as never, where: { and: [{ sequence: { equals: seq.id } }, { panel: { equals: panel.id } }] } as Where, limit: 1, ...opts })
    if (already.docs.length) {
      await payload.update({ collection: c.sequences as never, id: seq.id as never, data: { status: 'assigned' } as never, ...opts })
      continue
    }
    const { result, problems } = await args.evaluate({ residues: String(seq.residues), queryId: String(seq.id), panel })
    if (!result) {
      await payload.update({ collection: c.sequences as never, id: seq.id as never, data: { status: 'not-assessable', statusReason: (problems.join('; ') || 'The panel\'s checks refused this sequence.').slice(0, 1000) } as never, ...opts })
      tally.notAssessable++
      continue
    }
    const tenant = sample[c.tenantField]
    await payload.create({ collection: c.assignments as never, data: {
      ...(c.subject ? { subject: idOf(sample.subject) } : {}), sequence: seq.id, panel: panel.id, summary: summarize(result, panel as never), result,
      ...(tenant != null ? { [c.tenantField]: idOf(tenant) } : {}),
    } as never, ...opts })
    await payload.update({ collection: c.sequences as never, id: seq.id as never, data: { status: 'assigned' } as never, ...opts })
    tally.assigned++
  }
  return { ...tally, checked: waiting.docs.length }
}
