import { validateResult, type Result } from '@captiveorigins/onephylogeny-core'
import { relationship as validateRelationship } from 'payload/shared'
import { either } from './access.js'
import { recordCollections, type RecordsOptions } from './records.js'
import { APIError, type Access, type CollectionBeforeChangeHook, type CollectionAfterChangeHook, type CollectionConfig, type Config, type Endpoint, type Field, type Plugin, type Where } from 'payload'

export type OnePhylogenyPluginOptions = {
  /** Slugs of the collections this plugin adds. */
  slugs?: { panels?: string; assignments?: string }
  /** Host collections to relate to. Leave one out and its field isn't added, so the plugin works in any site. */
  relations?: { subject?: string; sequence?: string; taxa?: string; files?: string; importRuns?: string }
  /** Who may create panels and results, and activate panels. Default: nobody but trusted local scripts. Activating also needs a signed-in user, who is recorded. */
  manageAccess?: Access
  /** Who may approve or reject results. Default: same as manageAccess. */
  reviewAccess?: Access
  /** Extra rule for reading released results, such as the host's own animal permissions. Default: signed-in users. */
  readReleasedAccess?: Access
  /** Field added to assignments for multi-tenant hosts' isolation plugins to find. */
  group?: string
  /**
   * Which panels results may be made against. `activeOrShown` also allows a `candidate` a maintainer ticked "shown as
   * exploratory", and lets readers see such candidates. Default: `active`.
   */
  resultsAgainst?: 'active' | 'activeOrShown'
  /**
   * Adds `samples` and `sequences`, with `registerSequence` to record a lab's file and `assignWaiting` to test waiting
   * sequences. Left out, neither collection is added. Results then relate to these sequences.
   */
  records?: RecordsOptions
  /**
   * The host's tenant (site) field on results, if it has one, such as a multi-tenant plugin adds. A result's site is set
   * when it is made and can't change, so a reviewer can't move it to a site whose people would then see it. Default `tenant`.
   */
  tenantField?: string
}

export { either, anyOf } from './access.js'
export { registerSequence, assignWaiting, readSingleSequence, summarize, type RecordsOptions, type RegisterSequenceInput, type Evaluate } from './records.js'

const PANEL_TRANSITIONS: Record<string, string[]> = { candidate: ['active', 'withdrawn'], active: ['superseded', 'withdrawn'], superseded: ['withdrawn'], withdrawn: [] }
const LOCKED_PANEL_FIELDS = ['key', 'version', 'marker', 'checksum', 'artifact', 'importRun', 'taxa', 'groups', 'notCovered', 'validatedScope']
const REVIEW_TRANSITIONS: Record<string, string[]> = { pending: ['approved', 'rejected'], approved: ['withdrawn'], rejected: [], withdrawn: [] }
const COORDINATES = /^(lat|lon|lng|latitude|longitude|latlon|lat_lon|coordinates?)$/i

const hasCoordinates = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasCoordinates)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(([k, v]) => COORDINATES.test(k) || hasCoordinates(v))
}

const fail = (message: string): never => { throw new APIError(message, 400, undefined, true) }
const idOf = (v: unknown) => (v && typeof v === 'object' ? String((v as { id: unknown }).id) : v == null ? undefined : String(v))
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const stripIds = (rows: unknown) => (Array.isArray(rows) ? rows.map((r) => { const { id: _id, ...rest } = r as Record<string, unknown>; return rest }) : rows)

const stamp = (v: unknown) => (v == null || v === '' ? '' : v instanceof Date ? v.toISOString() : String(v))
const ACTIVATION_FIELDS = ['activatedBy', 'activatedAt']

const panelBeforeChange: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  // Only a candidate can be shown as exploratory; leaving candidate clears it.
  const leaving = operation === 'update' && String(data.status ?? originalDoc.status) !== 'candidate'
  if (leaving) {
    if (data.shownAsExploratory === true && String(originalDoc.status) !== 'candidate') fail('Only a candidate panel can be shown as exploratory.')
    data.shownAsExploratory = false
  }
  if (hasCoordinates(data.groups)) fail('Panels use generalized regions and never hold coordinates.')
  if (operation === 'create') {
    if ((data.status ?? 'candidate') !== 'candidate') fail('A new panel starts as a candidate.')
    if (ACTIVATION_FIELDS.some((f) => stamp(data[f]))) fail('Who activated a panel, and when, are set by activating.')
    return data
  }
  const from = String(originalDoc.status)
  const to = String(data.status ?? from)
  if (to !== from && !PANEL_TRANSITIONS[from]?.includes(to)) fail(`A panel can't go from ${from} to ${to}.`)
  if (from === 'candidate' && to === 'active') {
    if (!((data.validatedScope ?? originalDoc.validatedScope) as unknown[] | undefined)?.length) fail('A panel with no validated claims can\'t become active.')
    if (!req.user) fail('Activating a panel needs a signed-in person, who is recorded.')
    data.activatedBy = String(req.user!.id)
    data.activatedAt = new Date().toISOString()
  } else if (ACTIVATION_FIELDS.some((f) => f in data && stamp(data[f]) !== stamp(originalDoc[f]))) {
    fail('Who activated a panel, and when, are set by activating.')
  }
  if (from !== 'candidate') {
    for (const f of LOCKED_PANEL_FIELDS) {
      if (!(f in data)) continue
      const changed = f === 'groups' ? !same(stripIds(data[f]), stripIds(originalDoc[f])) : Array.isArray(data[f]) ? !same(data[f].map(idOf), (originalDoc[f] ?? []).map(idOf)) : idOf(data[f]) !== idOf(originalDoc[f])
      if (changed) fail(`A ${from} panel can't be edited. Build a new version instead.`)
    }
  }
  return data
}

const supersedeOthers = (panels: string): CollectionAfterChangeHook => async ({ doc, previousDoc, req }) => {
  if (doc.status !== 'active' || previousDoc?.status === 'active') return doc
  const others = await req.payload.find({ collection: panels as never, where: { and: [{ key: { equals: doc.key } }, { status: { equals: 'active' } }, { id: { not_equals: doc.id } }] } as Where, limit: 100, depth: 0, req, overrideAccess: true })
  for (const other of others.docs as { id: string | number }[]) await req.payload.update({ collection: panels as never, id: other.id, data: { status: 'superseded' } as never, req, overrideAccess: true })
  return doc
}

const assignmentBeforeChange = (panels: string, againstShown: boolean, tenantField: string): CollectionBeforeChangeHook => async ({ data, originalDoc, operation, req }) => {
  if (operation === 'create') {
    if ((data.reviewStatus ?? 'pending') !== 'pending') fail('A new result starts as pending review.')
    const panel = await req.payload.findByID({ collection: panels as never, id: idOf(data.panel)!, depth: 0, req, overrideAccess: true }) as unknown as { key: string; version: string; checksum: string; status: string; shownAsExploratory?: boolean; groups?: { groupId: string }[] }
    const shown = panel.status === 'candidate' && panel.shownAsExploratory === true
    if (panel.status !== 'active' && !(againstShown && shown)) fail(againstShown ? 'Results can only be made against an active panel, or a candidate shown as exploratory.' : 'Results can only be made against an active panel.')
    // Stamped, so a result made against a candidate is never later read as reviewed.
    data.panelStatus = panel.status
    data.panelShownAsExploratory = shown
    const result = data.result as Result
    const problems = validateResult(result).filter((d) => d.severity === 'error')
    if (problems.length) fail(problems.map((p) => p.message).join('; '))
    if (result.panel.version !== panel.version || result.panel.checksum !== panel.checksum) fail('This result was not made with this panel version.')
    const found = new Set(result.findings.map((f) => f.group))
    const missing = (panel.groups ?? []).filter((g) => !found.has(g.groupId)).map((g) => g.groupId)
    if (missing.length) fail(`Every group must be reported. Missing: ${missing.join(', ')}.`)
    if (hasCoordinates(result)) fail('Results never hold coordinates.')
    return data
  }
  const from = String(originalDoc.reviewStatus)
  const to = String(data.reviewStatus ?? from)
  for (const f of ['result', 'panel', 'sequence', 'subject', 'summary', 'importRun']) {
    if (f in data && (f === 'result' || f === 'summary' ? !same(data[f], originalDoc[f]) : idOf(data[f]) !== idOf(originalDoc[f]))) fail("A result can't be edited. Make a new one instead.")
  }
  if (tenantField in data && idOf(data[tenantField]) !== idOf(originalDoc[tenantField])) fail('A result stays on the site it was made for.')
  for (const f of ['panelStatus', 'panelShownAsExploratory']) {
    if (f in data && !same(data[f], originalDoc[f])) fail('The panel status a result was made against is set when it is made.')
  }
  if (to !== from) {
    if (!REVIEW_TRANSITIONS[from]?.includes(to)) fail(`A result can't go from ${from} to ${to}.`)
    if (to === 'approved') {
      if (!req.user) fail('Approving a result needs a signed-in reviewer.')
      data.reviewer = String(req.user!.id)
      data.releasedAt = new Date().toISOString()
    }
  } else {
    if ('reviewer' in data && data.reviewer !== originalDoc.reviewer) fail('The reviewer is set by approving.')
    if ('releasedAt' in data && String(data.releasedAt) !== String(originalDoc.releasedAt)) fail('The release date is set by approving.')
  }
  return data
}

const relation = (name: string, relationTo: string | undefined, extra: Partial<Field> = {}): Field[] =>
  relationTo ? [{ name, type: 'relationship', relationTo, index: true, ...extra } as Field] : []

/**
 * A result's links are checked when it is made and can't change afterwards (the hook refuses it). Checking them again on
 * review would ask whether the reviewer may read the animal, which a site's reviewer often can't, and isn't the question.
 */
const checkedWhenMade = { validate: (value: unknown, options: { operation?: string }) => (options.operation === 'update' ? true : validateRelationship(value as never, options as never)) } as Partial<Field>

/**
 * OnePhylogeny for Payload. Adds immutable panels and reviewed results, relating to whatever collections a site already
 * has. It holds no species knowledge. Compute happens elsewhere: this stores what was computed and controls release.
 */
export const onePhylogeny = (options: OnePhylogenyPluginOptions = {}): Plugin => (config: Config): Config => {
  const panels = options.slugs?.panels ?? 'panels'
  const assignments = options.slugs?.assignments ?? 'assignments'
  const tenantField = options.tenantField ?? options.records?.tenantField ?? 'tenant'
  const records = options.records
    ? recordCollections({ tenantField, ...options.records }, { panels, assignments, subject: options.relations?.subject, taxa: options.relations?.taxa, files: options.relations?.files, manage: options.manageAccess ?? (() => false), againstShown: options.resultsAgainst === 'activeOrShown' })
    : undefined
  const r = { ...options.relations, ...(records && !options.relations?.sequence ? { sequence: records.config.sequences } : {}) }
  const group = options.group ?? 'Genetics'
  const manage: Access = options.manageAccess ?? (() => false)
  const review: Access = options.reviewAccess ?? manage
  const readReleased: Access = options.readReleasedAccess ?? (({ req }) => Boolean(req.user))
  const againstShown = options.resultsAgainst === 'activeOrShown'

  const panelCollection: CollectionConfig = {
    slug: panels,
    labels: { singular: 'Reference panel', plural: 'Reference panels' },
    admin: { group, useAsTitle: 'key', defaultColumns: ['key', 'version', 'status', 'marker'] },
    access: {
      read: async (args) => {
        const published: Where = { status: { in: ['active', 'superseded'] } }
        const shown: Where = { and: [{ status: { equals: 'candidate' } }, { shownAsExploratory: { equals: true } }] }
        return either(await manage(args), published, againstShown ? shown : false)
      },
      create: manage, update: manage, delete: () => false,
    },
    fields: [
      { name: 'key', type: 'text', required: true, index: true, admin: { description: 'Stays the same across versions of one panel.' } },
      { name: 'version', type: 'text', required: true },
      { name: 'status', type: 'select', required: true, defaultValue: 'candidate', index: true, options: ['candidate', 'active', 'superseded', 'withdrawn'] },
      { name: 'shownAsExploratory', type: 'checkbox', defaultValue: false, index: true, admin: { description: 'Show this candidate as exploratory, before review. Only candidates; cleared when it moves on.' } },
      { name: 'marker', type: 'text', required: true },
      { name: 'checksum', type: 'text', required: true, index: true },
      ...relation('taxa', r.taxa, { hasMany: true } as Partial<Field>),
      ...relation('artifact', r.files, { admin: { description: 'The full panel: JSON manifest and sequences.' } } as Partial<Field>),
      ...relation('importRun', r.importRuns),
      { name: 'validatedScope', type: 'text', hasMany: true, admin: { description: 'The claims this panel is validated for. Pages show only these.' } },
      { name: 'notCovered', type: 'text', hasMany: true },
      { name: 'groups', type: 'array', fields: [{ name: 'groupId', type: 'text', required: true }, { name: 'label', type: 'text', required: true }, { name: 'regionName', type: 'text', admin: { description: 'A general region, never coordinates.' } }] },
      { name: 'activatedBy', type: 'text', admin: { readOnly: true, description: 'The signed-in user who activated this panel. Set by activating.' } },
      { name: 'activatedAt', type: 'date', admin: { readOnly: true } },
    ],
    hooks: { beforeChange: [panelBeforeChange], afterChange: [supersedeOthers(panels)] },
  }

  const assignmentCollection: CollectionConfig = {
    slug: assignments,
    labels: { singular: 'Lineage result', plural: 'Lineage results' },
    admin: { group, useAsTitle: 'summary', defaultColumns: ['summary', 'panel', 'reviewStatus', 'releasedAt'] },
    access: {
      // Managers and reviewers see what their own rules allow, including pending results; everyone else only released ones.
      read: async (args) => {
        const released: Where = { reviewStatus: { equals: 'approved' } }
        const allowed = await readReleased(args)
        return either(await manage(args), await review(args), allowed === true ? released : allowed ? { and: [released, allowed] } : false)
      },
      create: manage,
      update: review,
      delete: () => false,
    },
    fields: [
      ...relation('subject', r.subject, checkedWhenMade),
      ...relation('sequence', r.sequence, checkedWhenMade),
      { name: 'panel', type: 'relationship', relationTo: panels, required: true, index: true, ...checkedWhenMade } as Field,
      { name: 'summary', type: 'text', required: true },
      { name: 'result', type: 'json', required: true, admin: { description: 'The OnePhylogeny result, stored exactly as computed.' } },
      ...relation('importRun', r.importRuns, checkedWhenMade),
      { name: 'reviewStatus', type: 'select', required: true, defaultValue: 'pending', index: true, options: ['pending', 'approved', 'rejected', 'withdrawn'] },
      { name: 'reviewer', type: 'text', admin: { readOnly: true } },
      { name: 'releasedAt', type: 'date', admin: { readOnly: true } },
      { name: 'panelStatus', type: 'text', admin: { readOnly: true, description: 'The panel\'s status when this result was made.' } },
      { name: 'panelShownAsExploratory', type: 'checkbox', admin: { readOnly: true } },
    ],
    hooks: { beforeChange: [assignmentBeforeChange(panels, againstShown, tenantField)] },
  }

  const released: Endpoint = {
    path: '/onephylogeny/released',
    method: 'get',
    handler: async (req) => {
      const subject = new URL(req.url ?? '', 'http://x').searchParams.get('subject')
      if (!subject || !r.subject) return Response.json({ error: 'A subject is required' }, { status: 400 })
      // Runs with the caller's permissions, so hidden results stay hidden.
      const found = await req.payload.find({ collection: assignments as never, where: { and: [{ subject: { equals: subject } }, { reviewStatus: { equals: 'approved' } }] } as Where, sort: '-releasedAt', limit: 20, depth: 1, req, overrideAccess: false })
      return Response.json({ docs: found.docs })
    },
  }

  return {
    ...config,
    collections: [...(config.collections ?? []), ...(records?.collections ?? []), panelCollection, assignmentCollection],
    endpoints: [...(config.endpoints ?? []), released],
    ...(records ? { custom: { ...config.custom, [records.customKey]: records.config } } : {}),
  }
}
