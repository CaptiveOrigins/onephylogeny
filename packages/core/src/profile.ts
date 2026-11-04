import type { Diagnostic, Profile } from './model.js'

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
