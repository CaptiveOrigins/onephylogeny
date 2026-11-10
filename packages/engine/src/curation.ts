import { parseCuration, type Curation, type Id, type RecordDecision } from '@captiveorigins/onephylogeny-core'

import type { Store } from './context.js'
import { profilePaths } from './run.js'

/**
 * Decision history (roadmap stage 3): every saved change to a curation, field by field, with when, by whom and why.
 * An append-only JSON Lines file beside `curation.json`, readable without the tool. Saving through `saveCuration` is the
 * only way the app and the CLI change a curation, so the history can't be skipped.
 */
export type CurationChange = { record: Id; field: keyof RecordDecision; from?: unknown; to?: unknown }
export type CurationHistoryEntry = { at: string; by?: string; reason?: string; changes: CurationChange[] }

export const historyPath = (profileId: string) => `profiles/${profileId}/curation-history.jsonl`

/** Field-by-field differences between two curations, in record then field order. */
export function curationDiff(before: Curation, after: Curation): CurationChange[] {
  const out: CurationChange[] = []
  for (const record of [...new Set([...Object.keys(before.records), ...Object.keys(after.records)])].sort()) {
    const a = (before.records[record] ?? {}) as Record<string, unknown>
    const b = (after.records[record] ?? {}) as Record<string, unknown>
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (JSON.stringify(a[field]) === JSON.stringify(b[field])) continue
      out.push({ record, field: field as keyof RecordDecision, ...(a[field] !== undefined ? { from: a[field] } : {}), ...(b[field] !== undefined ? { to: b[field] } : {}) })
    }
  }
  return out
}

/** Saves a curation and appends what changed to its history. Saving without a change writes nothing. */
export async function saveCuration(store: Store, profileId: string, next: Curation, meta: { at?: string; by?: string; reason?: string } = {}): Promise<CurationHistoryEntry | null> {
  const P = profilePaths(profileId)
  const before = (await store.exists(P.curation)) ? parseCuration(await store.read(P.curation)) : { schemaVersion: 1 as const, records: {} }
  const changes = curationDiff(before, next)
  if (!changes.length) return null
  const entry: CurationHistoryEntry = { at: meta.at ?? new Date().toISOString(), ...(meta.by ? { by: meta.by } : {}), ...(meta.reason ? { reason: meta.reason } : {}), changes }
  // History first: if the save then fails, the log shows an attempt, never a change it doesn't mention.
  const line = `${JSON.stringify(entry)}\n`
  if (store.append) await store.append(historyPath(profileId), line)
  else await store.write(historyPath(profileId), `${(await store.exists(historyPath(profileId))) ? await store.read(historyPath(profileId)) : ''}${line}`)
  await store.write(P.curation, `${JSON.stringify(next, null, 2)}\n`)
  return entry
}

/** The history, oldest first, optionally for one record. A damaged line is reported, not skipped silently. */
export async function readCurationHistory(store: Store, profileId: string, record?: Id): Promise<{ entries: CurationHistoryEntry[]; damagedLines: number[] }> {
  if (!(await store.exists(historyPath(profileId)))) return { entries: [], damagedLines: [] }
  const entries: CurationHistoryEntry[] = []
  const damagedLines: number[] = []
  ;(await store.read(historyPath(profileId))).split('\n').forEach((l, i) => {
    if (!l.trim()) return
    try {
      const e = JSON.parse(l) as CurationHistoryEntry
      const changes = record ? e.changes.filter((c) => c.record === record) : e.changes
      if (changes.length) entries.push({ ...e, changes })
    } catch {
      damagedLines.push(i + 1)
    }
  })
  return { entries, damagedLines }
}
