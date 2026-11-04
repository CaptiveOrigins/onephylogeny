import type { Curation, Diagnostic, Profile } from './model.js'

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** Reads a saved profile, checking its shape first, so a damaged or newer file fails with a clear message. */
export function parseProfile(text: string): Profile {
  let v: unknown
  try { v = JSON.parse(text) } catch { throw new Error('This profile file is not valid JSON') }
  if (!isObject(v)) throw new Error('This profile file is not a profile')
  if (v.schemaVersion !== 1) throw new Error(`This profile uses schema version ${String(v.schemaVersion)}, which this version can't read. Update OnePhylogeny`)
  const s = v.selection
  if (typeof v.id !== 'string' || !isObject(s) || !Array.isArray(s.taxa) || !isObject(s.marker) || !Array.isArray(s.outgroups) || !Array.isArray(s.exclude) || !isObject(s.filters)) throw new Error('This profile file is missing required fields')
  return v as unknown as Profile
}

export function parseCuration(text: string): Curation {
  let v: unknown
  try { v = JSON.parse(text) } catch { throw new Error('This curation file is not valid JSON') }
  if (!isObject(v) || v.schemaVersion !== 1 || !isObject(v.records)) throw new Error('This curation file is damaged or from a newer version')
  return v as unknown as Curation
}

/** Explains problems with a saved profile and repairs nothing. Errors mean it cannot be run. */
export function validateProfile(p: Profile): Diagnostic[] {
  const out: Diagnostic[] = []
  const error = (code: string, message: string, path: string) => out.push({ severity: 'error', code, message, path })
  if (p.schemaVersion !== 1) error('schema-version', `Unknown schema version ${String(p.schemaVersion)}`, 'schemaVersion')
  if (!p.id) error('missing-id', 'A profile needs an id', 'id')
  const s = p.selection
  if (!s.taxa.length) error('no-taxa', 'Select at least one ingroup taxon by source-qualified id', 'selection.taxa')
  if (s.marker.kind === 'gene' && !s.marker.gene) error('no-gene', 'A gene marker must name its gene', 'selection.marker.gene')
  if (s.filters.minLength !== undefined && s.filters.maxLength !== undefined && s.filters.minLength > s.filters.maxLength)
    error('length-range', 'minLength is greater than maxLength', 'selection.filters')
  for (const [i, e] of s.exclude.entries()) if (!e.reason.trim()) error('exclusion-without-reason', `Exclusion ${e.accession} has no reason`, `selection.exclude.${i}.reason`)
  for (const [i, e] of s.exclude.entries()) if (!/\.\d+$/.test(e.accession)) out.push({ severity: 'warning', code: 'exclusion-without-version', message: `Exclusion ${e.accession} has no accession version`, path: `selection.exclude.${i}.accession` })
  if (!s.outgroups.length) out.push({ severity: 'warning', code: 'no-outgroup', message: 'No outgroup selected, so the tree cannot be rooted from this profile', path: 'selection.outgroups' })
  if (p.tree && !Number.isInteger(p.tree.seed)) error('seed', 'A tree run needs an integer seed', 'tree.seed')
  return out
}
