import { describe, expect, it } from 'vitest'
import type { Curation, Profile } from '@captiveorigins/onephylogeny-core'
import { buildPanelFromRun, ENGINE_VERSION, fetchAndAnchor, loadPanel, profilePaths, testSample, type EngineContext, type Store } from '../src/index.js'

function randomSeq(n: number, seed: number): string {
  let a = seed >>> 0
  let out = ''
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out += 'ACGT'[((t ^ (t >>> 14)) >>> 0) % 4]
  }
  return out
}
const REF = randomSeq(600, 1)
const mutate = (at: number[], from = 0, to = 600) => [...REF].map((c, i) => (at.includes(i) ? (c === 'A' ? 'C' : 'A') : c)).join('').slice(from, to)
const gb = (acc: string, seq: string, def = 'gene x') => `LOCUS       ${acc}  ${seq.length} bp DNA\nDEFINITION  ${def}\nACCESSION   ${acc}\nVERSION     ${acc}.1\nFEATURES             Location/Qualifiers\n     source          1..${seq.length}\n                     /organism="Example taxon"\n                     /db_xref="taxon:1"\nORIGIN\n        1 ${seq.toLowerCase()}\n//\n`
const DB: Record<string, string> = {
  'R1.1': gb('R1', REF), 'A1.1': gb('A1', mutate([10, 200, 450])), 'A2.1': gb('A2', mutate([10, 200, 450, 300])),
  'B1.1': gb('B1', mutate([20, 210, 460])), 'B2.1': gb('B2', mutate([20, 210, 460, 310])),
  'W1.1': gb('W1', randomSeq(500, 99)), 'U1.1': gb('U1', mutate([50]), 'UNVERIFIED: gene x'),
}

function memory(): Store & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return { files, read: async (p) => { const v = files.get(p); if (v === undefined) throw new Error(`no file ${p}`); return v }, write: async (p, t) => void files.set(p, t), exists: async (p) => files.has(p) }
}
const profile: Profile = {
  schemaVersion: 1, id: 'demo', title: 'Demo',
  selection: { id: 's', title: 'S', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'gene', gene: 'x' }, outgroups: [], exclude: [{ accession: 'B2.1', reason: 'Chimera in the source paper' }], filters: { minLength: 100 } },
  reference: { accession: 'R1.1' },
  panel: { id: 'p', version: '1', groups: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], notCovered: ['Elsewhere'], validatedScope: [], thresholds: { minOverlap: 50, tolerance: 1, minDiagnosticConflicts: 2 } },
}

function makeContext(failFetch: () => boolean = () => false): EngineContext & { store: ReturnType<typeof memory>; requested: string[] } {
  const store = memory()
  const requested: string[] = []
  let tick = 0
  return {
    store, requested, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    ncbi: {
      sleep: async () => {}, delayMs: 0, retries: 0,
      fetch: async (url, init) => {
        const p = new URLSearchParams(init!.body)
        if (url.includes('esearch')) return { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { count: '6', idlist: Object.keys(DB).filter((k) => k !== 'R1.1') } }) }
        if (failFetch()) return { ok: false, status: 500, text: async () => '' }
        const ids = p.get('id')!.split(',')
        requested.push(...ids)
        return { ok: true, status: 200, text: async () => ids.map((i) => DB[i]!).join('') }
      },
    },
  }
}

describe('fetchAndAnchor', () => {
  it('keeps a complete record of what happened', async () => {
    const ctx = makeContext()
    const { run, outcomes } = await fetchAndAnchor(ctx, profile)
    expect(run.status).toBe('succeeded')
    const by = Object.fromEntries(outcomes.map((o) => [o.record, o]))
    expect(by['A1.1']!.status).toBe('passed')
    expect(by['W1.1']!.diagnostics.map((d) => d.code)).toContain('no-reference-match')
    expect(by['U1.1']!.diagnostics.map((d) => d.code)).toContain('unverified')
    expect(by['B2.1']!.diagnostics.find((d) => d.code === 'excluded-by-profile')!.message).toMatch(/Chimera/)
    const dir = profilePaths('demo').run(run.id)
    for (const f of ['run.json', 'snapshot.json', 'records.csv', 'outcomes.json', 'aligned.fasta', 'events.jsonl']) expect(ctx.store.files.has(`${dir}/${f}`), f).toBe(true)
    expect(ctx.store.files.get(`${dir}/records.csv`)!.split('\n')[0]).toContain('accession')
  })
  it('stops and records a failure, then resumes from its cache without re-downloading', async () => {
    let calls = 0
    const ctx = makeContext(() => ++calls === 2)
    await expect(fetchAndAnchor(ctx, profile, { batchSize: 3 })).rejects.toThrow(/efetch/)
    const failed = [...ctx.store.files.keys()].find((k) => k.endsWith('run.json'))!
    expect(JSON.parse(ctx.store.files.get(failed)!).status).toBe('failed')
    const before = ctx.requested.length
    const { run, records } = await fetchAndAnchor(ctx, profile, { batchSize: 3 })
    expect(run.status).toBe('succeeded')
    expect(records).toHaveLength(7)
    expect(new Set(ctx.requested).size).toBe(ctx.requested.length)
    expect(ctx.requested.length).toBeGreaterThan(before)
  })
})

describe('panel and sample', () => {
  const curation: Curation = { schemaVersion: 1, records: {
    'A1.1': { group: 'a', provenanceClass: 'wild-documented', site: 's1' }, 'A2.1': { group: 'a', provenanceClass: 'wild-documented', site: 's2' },
    'B1.1': { group: 'b', provenanceClass: 'seized', site: 's3' },
  } }
  it('runs end to end, from fetch to a sample result', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    const out = await buildPanelFromRun(ctx, profile, curation)
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(out.unassigned).toBe(1)
    const bundle = await loadPanel(ctx.store, profilePaths('demo').panel('p', '1'))
    expect(bundle.panel.checksum).toBe(out.bundle.panel.checksum)
    const sample = testSample(mutate([10, 200, 450], 0, 500), 'sample-1', bundle)
    expect(sample.result?.findings.find((f) => f.group === 'a')?.status).toBe('consistent')
    expect(sample.result?.findings.find((f) => f.group === 'b')?.status).toBe('excluded_within_panel')
  })
  it('refuses a sample of a different gene with a reason', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    const { bundle } = await buildPanelFromRun(ctx, profile, curation)
    const r = testSample(randomSeq(400, 1234), 'wrong', bundle)
    expect(r.result).toBeNull()
    expect(r.diagnostics[0]!.code).toBe('no-reference-match')
  })
  it('reports a group the curation names but the panel lacks', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    const out = await buildPanelFromRun(ctx, profile, { schemaVersion: 1, records: { 'A1.1': { group: 'nope' } } })
    expect(out.diagnostics.map((d) => d.code)).toContain('unknown-group')
  })
})

describe('runs and panels stay true', () => {
  const curation: Curation = { schemaVersion: 1, records: { 'A1.1': { group: 'a', provenanceClass: 'wild-documented' }, 'B1.1': { group: 'b', provenanceClass: 'wild-documented' } } }
  it('a failed run never replaces the last good one', async () => {
    let fail = false
    const ctx = makeContext(() => fail)
    const good = await fetchAndAnchor(ctx, profile)
    const P = profilePaths('demo')
    expect(await ctx.store.read(P.latest)).toBe(good.run.id)
    fail = true
    ctx.store.files.forEach((_, k) => { if (k.startsWith('cache/')) ctx.store.files.delete(k) })
    await expect(fetchAndAnchor(ctx, profile)).rejects.toThrow()
    expect(await ctx.store.read(P.latest)).toBe(good.run.id)
    await expect(buildPanelFromRun(ctx, profile, curation)).resolves.toBeTruthy()
  })
  it('writes a running record first, so a crash still leaves a trace', async () => {
    const ctx = makeContext()
    const written: string[] = []
    const inner = ctx.store.write
    ctx.store.write = async (p, t) => { if (p.endsWith('run.json')) written.push(JSON.parse(t).status); return inner(p, t) }
    await fetchAndAnchor(ctx, profile)
    expect(written).toEqual(['running', 'succeeded'])
  })
  it('records what produced each run, panel and result', async () => {
    const ctx = makeContext()
    const { run } = await fetchAndAnchor(ctx, profile)
    expect(run.tools.map((t) => t.name)).toEqual(['onephylogeny-engine', 'alignToReference'])
    const { bundle } = await buildPanelFromRun(ctx, profile, curation)
    expect(bundle.panel.builtWith?.[0]?.version).toBe(ENGINE_VERSION)
    const sample = testSample(mutate([10, 200, 450]), 's', bundle)
    expect(sample.result?.producedBy?.length).toBeGreaterThan(1)
    expect(sample.result?.querySha256).toMatch(/^sha256:/)
  })
  it('editing a profile cannot change a built panel\'s conclusions', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    const { bundle } = await buildPanelFromRun(ctx, profile, curation)
    const loaded = await loadPanel(ctx.store, profilePaths('demo').panel('p', '1'))
    const before = testSample(mutate([10, 200, 450]), 's', loaded)
    expect(loaded.panel.thresholds).toEqual(profile.panel!.thresholds)
    expect(bundle.panel.checksum).toBe(loaded.panel.checksum)
    expect(before.result?.panel.checksum).toBe(bundle.panel.checksum)
  })
  it('refuses to overwrite a version with different content, and allows an identical rebuild', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    await buildPanelFromRun(ctx, profile, curation)
    await expect(buildPanelFromRun(ctx, profile, curation)).resolves.toBeTruthy()
    const changed = { ...curation, records: { ...curation.records, 'A2.1': { group: 'a', provenanceClass: 'wild-documented' as const } } }
    await expect(buildPanelFromRun(ctx, profile, changed)).rejects.toThrow(/already exists with different content/)
  })
  it('uses append for logs when the store offers it', async () => {
    const ctx = makeContext()
    const lines: string[] = []
    ctx.store.append = async (_p, t) => void lines.push(t)
    await fetchAndAnchor(ctx, profile)
    expect(lines.length).toBeGreaterThan(2)
    expect(() => JSON.parse(lines[0]!)).not.toThrow()
  })
  it('puts check results in the spreadsheet', async () => {
    const ctx = makeContext()
    const { run } = await fetchAndAnchor(ctx, profile)
    const sheet = ctx.store.files.get(`${profilePaths('demo').run(run.id)}/records.csv`)!
    expect(sheet.split('\n')[0]).toContain('check_status,check_reasons')
    expect(sheet).toContain('excluded')
  })
})
