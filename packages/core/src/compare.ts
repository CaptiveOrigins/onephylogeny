import { canonicalJson } from './panel.js'
import type { Panel, StudyLink } from './model.js'
import type { ClaimReport } from './validation.js'

/**
 * Compares two built panels: which records and groups changed, and which claims moved.
 * It reports differences and never picks a winner, because choosing the best-looking run after comparing isn't a test.
 */
type ClaimState = { passed: boolean; failedGate?: string; sites: { a: number; b: number }; records: { a: number; b: number } }
export type ClaimChange = 'same' | 'gained' | 'lost' | 'changed' | 'only-a' | 'only-b' | 'unknown'

/** What moved inside a claim's report. A claim can pass both times and still rest on different evidence. */
export type GateChange = { gate: string; before: string | null; after: string | null }

export type ClaimComparison = { a: string; b: string; window: string; change: ClaimChange; before: ClaimState | null; after: ClaimState | null; gates: GateChange[]; otherFields: string[] }

type Side = { id: string; version: string; checksum: string; study?: StudyLink; hasValidation: boolean }

export type RunComparison = {
  a: Side
  b: Side
  /** The aligned sequences and reference are byte for byte the same. */
  sameSequences: boolean
  records: { shared: number; onlyA: string[]; onlyB: string[]; changedGroup: { record: string; a: string; b: string }[]; changedEvidence: { field: string; records: { record: string; a: string | null; b: string | null }[] }[] }
  claims: ClaimComparison[]
  /** Settings that differ, so a change in the results may not come from the records. */
  settings: string[]
  /** Records each side left out after results were seen, and whether the other side has them. Can't be turned off. */
  postHoc: { side: 'a' | 'b'; omitted: string[]; inOtherSide: string[] }[]
  notes: string[]
}

const members = (panel: Panel) => {
  const out = new Map<string, { group: string; evidence: Record<string, unknown> }>()
  for (const g of panel.groups) for (const e of g.evidence) out.set(e.record, { group: g.id, evidence: e })
  return out
}

/** Every evidence field, not a chosen few: relabeling a record's study changes a gate without changing its group. */
function evidenceChanges(shared: string[], ma: ReturnType<typeof members>, mb: ReturnType<typeof members>): RunComparison['records']['changedEvidence'] {
  const byField = new Map<string, { record: string; a: string | null; b: string | null }[]>()
  const text = (v: unknown) => (v === undefined || v === null ? null : typeof v === 'string' ? v : canonicalJson(v))
  for (const record of shared) {
    const x = ma.get(record)!.evidence
    const y = mb.get(record)!.evidence
    for (const field of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (canonicalJson(x[field] ?? null) === canonicalJson(y[field] ?? null)) continue
      byField.set(field, [...(byField.get(field) ?? []), { record, a: text(x[field]), b: text(y[field]) }])
    }
  }
  return [...byField].map(([field, records]) => ({ field, records })).sort((p, q) => p.field.localeCompare(q.field))
}

function gateChanges(x?: ClaimReport, y?: ClaimReport): GateChange[] {
  const before = new Map((x?.gates ?? []).map((g) => [g.gate as string, g]))
  const after = new Map((y?.gates ?? []).map((g) => [g.gate as string, g]))
  const out: GateChange[] = []
  for (const gate of new Set([...before.keys(), ...after.keys()])) {
    const s = before.get(gate)
    const t = after.get(gate)
    if (canonicalJson(s ?? null) !== canonicalJson(t ?? null)) out.push({ gate, before: s ? s.detail : null, after: t ? t.detail : null })
  }
  return out
}

function otherFields(x?: ClaimReport, y?: ClaimReport): string[] {
  if (!x || !y) return []
  const a = x as unknown as Record<string, unknown>
  const b = y as unknown as Record<string, unknown>
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'gates' && canonicalJson(a[k] ?? null) !== canonicalJson(b[k] ?? null)).sort()
}

const stateOf = (c: ClaimReport): ClaimState => {
  const failed = c.gates.find((g) => !g.passed)
  return { passed: c.passed, sites: c.sites, records: c.records, ...(failed ? { failedGate: failed.gate } : {}) }
}

const key = (c: { a: string; b: string; window: string }) => `${c.a}|${c.b}|${c.window}`

function compareClaims(a: Panel, b: Panel, ra?: ClaimReport[], rb?: ClaimReport[]): ClaimComparison[] {
  if (!ra || !rb) {
    // A panel lists only claims that passed, so without both reports a claim absent from one side is unknown, not lost.
    const listA = a.claims ?? []
    const listB = b.claims ?? []
    const keys = new Map([...listA, ...listB].map((c) => [key(c), c]))
    return [...keys.values()].map((c) => {
      // Without reports nothing shows the evidence is the same, only that both list the claim.
      return { a: c.a, b: c.b, window: c.window, change: 'unknown' as const, before: null, after: null, gates: [], otherFields: [] }
    })
  }
  const before = new Map(ra.map((c) => [key(c), c]))
  const after = new Map(rb.map((c) => [key(c), c]))
  const out: ClaimComparison[] = []
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(k)
    const y = after.get(k)
    const ref = (x ?? y)!
    const s = x ? stateOf(x) : null
    const t = y ? stateOf(y) : null
    // "Same" means the whole report is the same, so a result that passes for new reasons can't look unchanged.
    const change: ClaimChange = !s ? 'only-b' : !t ? 'only-a' : s.passed !== t.passed ? (t.passed ? 'gained' : 'lost') : canonicalJson(x) === canonicalJson(y) ? 'same' : 'changed'
    out.push({ a: ref.a, b: ref.b, window: ref.window, change, before: s, after: t, gates: gateChanges(x, y), otherFields: otherFields(x, y) })
  }
  return out
}

/** Names for panel fields that can differ between versions. Anything not named here is still reported, under its field name. */
const FIELD_LABELS: Record<string, string> = {
  rules: 'Evaluation rules', windows: 'Windows', reference: 'Reference', gates: 'Record checks', numtCopies: 'Nuclear copies', builtWith: 'Software',
  taxa: 'Taxa', marker: 'Marker', notCovered: 'Not covered', sources: 'Sources', builtBy: 'Fetched data', pairs: 'Site tables', status: 'Status',
}
/** Reported in their own right elsewhere, or expected to differ between any two versions. */
const REPORTED_APART = new Set(['id', 'version', 'checksum', 'groups', 'claims', 'validatedScope', 'study', 'sequencesChecksum'])

function differentSettings(a: Panel, b: Panel, ra?: ClaimReport[], rb?: ClaimReport[]): string[] {
  const out: string[] = []
  const check = (label: string, x: unknown, y: unknown) => { if (canonicalJson(x ?? null) !== canonicalJson(y ?? null)) out.push(label) }
  const x = a as unknown as Record<string, unknown>
  const y = b as unknown as Record<string, unknown>
  for (const field of new Set([...Object.keys(x), ...Object.keys(y)])) if (!REPORTED_APART.has(field)) check(FIELD_LABELS[field] ?? field, x[field], y[field])
  const bare = (p: Panel) => p.groups.map(({ evidence: _e, ...g }) => g)
  check('Groups', bare(a), bare(b))
  const gates = (r?: ClaimReport[]) => [...new Set((r ?? []).flatMap((c) => c.gates.map((g) => g.gate)))].sort()
  if (ra && rb) check('Validation gates', gates(ra), gates(rb))
  return out.sort()
}

/** An older panel's report may not have claims in this form, which is the same as having no report. */
const usable = (r?: ClaimReport[]) => (Array.isArray(r) && r.every((c) => Array.isArray(c.gates)) ? r : undefined)

export function compareRuns(a: Panel, b: Panel, givenA?: ClaimReport[], givenB?: ClaimReport[]): RunComparison {
  const reportA = usable(givenA)
  const reportB = usable(givenB)
  const ma = members(a)
  const mb = members(b)
  const onlyA = [...ma.keys()].filter((r) => !mb.has(r)).sort()
  const onlyB = [...mb.keys()].filter((r) => !ma.has(r)).sort()
  const shared = [...ma.keys()].filter((r) => mb.has(r)).sort()
  const changedGroup = shared.filter((r) => ma.get(r)!.group !== mb.get(r)!.group).map((record) => ({ record, a: ma.get(record)!.group, b: mb.get(record)!.group }))
  const postHoc = ([['a', a, mb], ['b', b, ma]] as const).flatMap(([side, panel, other]) => {
    const omitted = panel.study?.postHocOmitted ?? []
    return omitted.length ? [{ side, omitted, inOtherSide: omitted.filter((r) => other.has(r)) }] : []
  })
  const notes: string[] = []
  if (!reportA || !reportB) notes.push('A validation report is missing, so claims that failed can\'t be compared.')
  for (const p of postHoc) {
    const name = p.side === 'a' ? a.version : b.version
    if (p.inOtherSide.length < p.omitted.length) notes.push(`Version ${name} left out ${p.omitted.length} records after results were seen, and the other version has ${p.inOtherSide.length} of them. Compare it with a version built without those omissions.`)
  }
  const side = (p: Panel, report?: ClaimReport[]): Side => ({ id: p.id, version: p.version, checksum: p.checksum ?? '', hasValidation: Boolean(report), ...(p.study ? { study: p.study } : {}) })
  return {
    a: side(a, reportA), b: side(b, reportB),
    sameSequences: a.sequencesChecksum === b.sequencesChecksum,
    records: { shared: shared.length, onlyA, onlyB, changedGroup, changedEvidence: evidenceChanges(shared, ma, mb) },
    claims: compareClaims(a, b, reportA, reportB),
    settings: differentSettings(a, b, reportA, reportB),
    postHoc, notes,
  }
}
