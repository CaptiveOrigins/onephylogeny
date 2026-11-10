import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'
import { describe, expect, it } from 'vitest'
import type { Curation, Profile } from '@captiveorigins/onephylogeny-core'
import { buildPanelFromRun, checkExamples, comparePanelVersions, panelVersions, EngineError, ENGINE_VERSION, fetchAndAnchor, loadArtifact, loadPanel, loadRunRecords, historyPath, profilePaths, readCurationHistory, routeSample, runSample, saveCuration, testSample, traceArtifact, verifyDataset, writeDataset, type DatasetManifest, type EngineContext, type PanelExamples, type Store } from '../src/index.js'

const ajv = new Ajv({ allErrors: true, strict: false })
const schemaRoot = fileURLToPath(new URL('../../', import.meta.url))
const validate = (pkg: string, name: string) => {
  const schema = JSON.parse(readFileSync(`${schemaRoot}${pkg}/schemas/${name}.schema.json`, 'utf8')) as { $id: string }
  return ajv.getSchema(schema.$id) ?? ajv.compile(schema)
}

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
  panel: { id: 'p', version: '1', groups: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], notCovered: ['Elsewhere'], validatedScope: [], rules: { minSharedColumns: 50, minDepthPerColumn: 1, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 } },
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
    'B1.1': { group: 'b', provenanceClass: 'wild-documented', site: 's3' },
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
  it('cuts the marker out of an unannotated genome, then applies the usual checks', async () => {
    const flankL = randomSeq(4000, 7), flankR = randomSeq(6000, 8)
    const chosen: Profile = { ...profile, selection: { ...profile.selection, include: ['A1.1', 'G1.1', 'G2.1', 'G3.1', 'G4.1'], filters: { ...profile.selection.filters, maxLength: 2000 } } }
    const ctx = makeContext()
    const added = { 'G1.1': gb('G1', flankL + mutate([10, 200, 450]) + flankR, 'mitochondrion, complete genome'), 'G2.1': gb('G2', flankL + REF + randomSeq(3000, 9) + mutate([5, 400], 0, 600) + flankR, 'mitochondrion, complete genome'), 'G3.1': gb('G3', randomSeq(9000, 11), 'mitochondrion, complete genome'), 'G4.1': gb('G4', flankL + mutate([10, 200, 450]).slice(0, 150) + flankR, 'mitochondrion, complete genome') }
    Object.assign(DB, added)
    try {
      const { outcomes } = await fetchAndAnchor(ctx, chosen)
      const by = (r: string) => outcomes.find((o) => o.record === r)!
      expect(by('G1.1')).toMatchObject({ status: 'passed', extractedFrom: 'located' })
      expect(by('G1.1').diagnostics.find((d) => d.code === 'located-by-similarity')?.message).toMatch(/bases 3971 to 4630 on the given strand/)
      expect(by('G1.1').columns).toBe(600)
      expect(by('G1.1').diagnostics.map((d) => d.code)).not.toContain('clipped-ends')
      // A similar annotated record gives the same alignment as the located one.
      expect(by('G1.1').identity).toBe(by('A1.1').identity)
      expect(by('G2.1')).toMatchObject({ status: 'excluded', extractedFrom: 'whole-record' })
      expect(by('G2.1').diagnostics.map((d) => d.code)).toContain('marker-in-several-places')
      expect(by('G3.1')).toMatchObject({ status: 'excluded', extractedFrom: 'whole-record' })
      // Too little of the marker fails coverage once it's cut out. Left whole, it would have skipped that check.
      expect(by('G4.1')).toMatchObject({ status: 'excluded' })
    } finally { for (const k of Object.keys(added)) delete DB[k] }
  })
  it('seals the Study behind a fetch into the panel, even if the profile moves on', async () => {
    const ctx = makeContext()
    const fromStudy = { id: 'study-1', title: 'Study 1', stateHash: 'sha256:abc', postHocOmitted: ['B9.1'] }
    const chosen: Profile = { ...profile, selection: { ...profile.selection, fromStudy } }
    await fetchAndAnchor(ctx, chosen)
    // Today's profile no longer names the Study. The panel describes the fetch its records came from.
    const out = await buildPanelFromRun(ctx, profile, curation)
    expect(out.bundle.panel.study).toEqual(fromStudy)
    const dir = profilePaths('demo').panel('p', '1')
    const stored = JSON.parse(ctx.store.files.get(`${dir}/panel.json`)!)
    stored.study.postHocOmitted = []
    ctx.store.files.set(`${dir}/panel.json`, JSON.stringify(stored))
    await expect(loadPanel(ctx.store, dir)).rejects.toThrow(/seal/)
  })
  it("doesn't change what's fetched or validated when a Study is named", async () => {
    const plain = makeContext()
    await fetchAndAnchor(plain, profile)
    const a = await buildPanelFromRun(plain, profile, curation)
    const named = makeContext()
    await fetchAndAnchor(named, { ...profile, selection: { ...profile.selection, fromStudy: { id: 's', title: 'S', stateHash: 'h', postHocOmitted: [] } } })
    const b = await buildPanelFromRun(named, profile, curation)
    expect(b.bundle.panel.builtBy).toBe(a.bundle.panel.builtBy)
    expect(b.bundle.panel.sequencesChecksum).toBe(a.bundle.panel.sequencesChecksum)
    expect(b.validation).toEqual(a.validation)
  })
  it('compares two built versions, and refuses one that changed after sealing', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    await buildPanelFromRun(ctx, profile, curation)
    const next: Profile = { ...profile, panel: { ...profile.panel!, version: '2' } }
    const moved = { schemaVersion: 1 as const, records: { ...curation.records, 'A2.1': { ...curation.records['A2.1']!, group: 'b' } } }
    await buildPanelFromRun(ctx, next, moved)
    const c = await comparePanelVersions(ctx.store, profile, '1', '2')
    expect(c.records.changedGroup).toEqual([{ record: 'A2.1', a: 'a', b: 'b' }])
    expect(c.a.hasValidation && c.b.hasValidation).toBe(true)
    const dir = profilePaths('demo').panel('p', '2')
    const stored = JSON.parse(ctx.store.files.get(`${dir}/panel.json`)!)
    stored.notCovered = []
    ctx.store.files.set(`${dir}/panel.json`, JSON.stringify(stored))
    await expect(comparePanelVersions(ctx.store, profile, '1', '2')).rejects.toThrow(/seal/)
  })
  it('lists every version in order, and only this panel', () => {
    expect(panelVersions(profile, ['p-0.10.0', 'p-0.2.0', 'p-0.9.1', 'other-1.0.0'])).toEqual(['0.2.0', '0.9.1', '0.10.0'])
  })
  it('refuses a panel whose files changed after sealing', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    await buildPanelFromRun(ctx, profile, curation)
    const dir = profilePaths('demo').panel('p', '1')
    const fasta = ctx.store.files.get(`${dir}/panel.fasta`)!
    const body = fasta.split('\n')
    const line = body.findIndex((l, i) => i > 2 && /^[ACGT-]+$/.test(l) && /[ACGT]/.test(l))
    body[line] = body[line]!.replace(/[ACGT]/, (c) => (c === 'A' ? 'C' : 'A'))
    ctx.store.files.set(`${dir}/panel.fasta`, body.join('\n'))
    await expect(loadPanel(ctx.store, dir)).rejects.toMatchObject({ code: 'panel-changed' })
    ctx.store.files.set(`${dir}/panel.fasta`, fasta)
    const panel = JSON.parse(ctx.store.files.get(`${dir}/panel.json`)!) as { notCovered: string[] }
    ctx.store.files.set(`${dir}/panel.json`, JSON.stringify({ ...panel, notCovered: [] }))
    await expect(loadPanel(ctx.store, dir)).rejects.toMatchObject({ code: 'panel-changed' })
  })
  it('seals the checks that ran, and reads samples with them', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    const { bundle } = await buildPanelFromRun(ctx, profile, curation)
    expect(bundle.panel.gates.frameErrors).toBe(true)
    const strict = { ...bundle, panel: { ...bundle.panel, gates: { ...bundle.panel.gates, minIdentity: 0.9999 } } }
    const sequence = mutate([10, 200, 450], 0, 500)
    expect(testSample(sequence, 's', bundle).result).not.toBeNull()
    expect(testSample(sequence, 's', strict).diagnostics.map((d) => d.code)).toContain('low-identity')
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
    const ctx = makeContext()
    const good = await fetchAndAnchor(ctx, profile)
    const P = profilePaths('demo')
    expect(await ctx.store.read(P.latest)).toBe(good.run.id)
    ctx.ncbi = { ...ctx.ncbi, fetch: async () => ({ ok: false, status: 500, text: async () => '' }) }
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
    expect(run.artifacts.map((a) => a.type)).toEqual(['accession-list', 'raw-records', 'anchored-records', 'gated-records'])
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
    expect(loaded.panel.rules).toEqual(profile.panel!.rules)
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

const stepsRun = (events: { step: string; data?: Record<string, unknown> }[], status: string) => events.filter((e) => e.data?.status === status).map((e) => e.step)
function withEvents() {
  const ctx = makeContext()
  const events: { step: string; data?: Record<string, unknown> }[] = []
  ctx.onEvent = (e) => events.push(e)
  return { ctx, events, reset: () => { events.length = 0 } }
}
const curation2: Curation = { schemaVersion: 1, records: {
  'A1.1': { group: 'a', provenanceClass: 'wild-documented', site: 's1' }, 'A2.1': { group: 'a', provenanceClass: 'wild-documented', site: 's2' }, 'B1.1': { group: 'b', provenanceClass: 'wild-documented', site: 's3' },
} }

describe('a NUMT library from a screen', () => {
  const curation = curation2
  const copy = mutate([3, 33, 63, 93, 123, 153, 183, 213, 243, 273, 303, 333, 363, 393, 423, 453, 483, 513, 543, 573])
  it('is sealed into new panels, flags a close sequence, and never says a clean one is cleared', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    const plain = await buildPanelFromRun(ctx, profile, curation)
    expect(plain.bundle.panel.numtCopies).toBeUndefined()
    await ctx.store.write(`profiles/${profile.id}/numt-screen/numt-library.fasta`, `>locus1 scaffold:1-600\n${copy}\n`)
    const panelled = { ...profile, panel: { ...profile.panel!, version: '9.9.9' } }
    const { bundle } = await buildPanelFromRun(ctx, panelled, curation)
    expect(bundle.panel.numtCopies).toEqual([{ id: 'locus1', aligned: copy }])
    const flagged = testSample(copy, 'looks-nuclear', bundle)
    expect(flagged.diagnostics.map((d) => d.code)).toContain('numt-flagged')
    expect(flagged.result?.caveats.join(' ')).toContain('Flagged for review')
    const clean = testSample(REF, 'clean', bundle)
    expect(clean.diagnostics.map((d) => d.code)).not.toContain('numt-flagged')
    expect(clean.result?.caveats.join(' ')).toContain("doesn't clear it")
  })
})

describe('content-addressed steps', () => {
  it('reuses every step when nothing changed', async () => {
    const { ctx, events, reset } = withEvents()
    await fetchAndAnchor(ctx, profile)
    reset()
    const requests = ctx.requested.length
    await fetchAndAnchor(ctx, profile)
    expect(stepsRun(events, 'running')).toEqual([])
    expect(stepsRun(events, 'reused')).toEqual(['search', 'fetch', 'anchor', 'gate'])
    expect(ctx.requested.length).toBe(requests)
  })
  it('changing a filter reruns only the gate', async () => {
    const { ctx, events, reset } = withEvents()
    await fetchAndAnchor(ctx, profile)
    reset()
    await fetchAndAnchor(ctx, { ...profile, selection: { ...profile.selection, filters: { minLength: 200 } } })
    expect(stepsRun(events, 'running')).toEqual(['gate'])
    expect(stepsRun(events, 'reused')).toEqual(['search', 'fetch', 'anchor'])
  })
  it('changing a threshold rebuilds only the panel steps, under a new version', async () => {
    const { ctx, events, reset } = withEvents()
    await fetchAndAnchor(ctx, profile)
    await buildPanelFromRun(ctx, profile, curation2)
    reset()
    const changed = { ...profile, panel: { ...profile.panel!, version: '2', rules: { ...profile.panel!.rules, tolerance: 3 } } }
    await buildPanelFromRun(ctx, changed, curation2)
    expect(stepsRun(events, 'running')).toEqual(['validate', 'panel'])
    expect(stepsRun(events, 'running')).not.toContain('anchor')
  })
  it('rebuilding when a stored output was altered, not trusting it', async () => {
    const { ctx, events, reset } = withEvents()
    const { run } = await fetchAndAnchor(ctx, profile)
    const gate = run.artifacts.find((a) => a.type === 'gated-records')!
    ctx.store.files.set(`artifacts/gated-records/${gate.key.replace('sha256:', '')}/aligned.fasta`, 'tampered')
    reset()
    await fetchAndAnchor(ctx, profile)
    expect(stepsRun(events, 'running')).toEqual(['gate'])
  })
  it('notices a raw file that changed after it was fetched', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    ctx.store.files.set('cache/genbank/A1.1.gb', 'changed')
    await expect(fetchAndAnchor(ctx, { ...profile, reference: { accession: 'R1.1', codonStart: 0 } })).resolves.toBeTruthy()
    const other = { ...profile, selection: { ...profile.selection, marker: { kind: 'gene' as const, gene: 'y' } } }
    await expect(fetchAndAnchor(ctx, other)).rejects.toMatchObject({ code: 'raw-file-changed' })
  })
})

describe('surviving a crash at any point', () => {
  it('recovers to the same result, wherever a write fails', async () => {
    const clean = makeContext()
    const baseline = await fetchAndAnchor(clean, profile)
    await buildPanelFromRun(clean, profile, curation2)
    const cleanPanel = (await loadPanel(clean.store, profilePaths('demo').panel('p', '1'))).panel.checksum
    let total = 0
    const counting = makeContext()
    const countWrite = counting.store.write
    counting.store.write = async (p, t) => { total++; return countWrite(p, t) }
    await fetchAndAnchor(counting, profile)
    await buildPanelFromRun(counting, profile, curation2)
    let crashes = 0
    for (let failAt = 1; failAt <= total; failAt++) {
      const ctx = makeContext()
      const write = ctx.store.write
      let writes = 0
      ctx.store.write = async (p, t) => { if (++writes === failAt) throw new Error('simulated crash'); return write(p, t) }
      await (async () => {
        await fetchAndAnchor(ctx, profile)
        await buildPanelFromRun(ctx, profile, curation2)
      })().then(() => {}, () => { crashes++ })
      ctx.store.write = write
      const { outcomes } = await fetchAndAnchor(ctx, profile)
      expect(outcomes).toEqual(baseline.outcomes)
      await buildPanelFromRun(ctx, profile, curation2)
      expect((await loadPanel(ctx.store, profilePaths('demo').panel('p', '1'))).panel.checksum).toBe(cleanPanel)
      expect(new Set(ctx.requested).size).toBe(7)
    }
    expect(crashes).toBeGreaterThan(10)
  })
})

describe('cancelling', () => {
  it('stops at a safe point, records it, keeps finished steps, and resumes', async () => {
    const controller = new AbortController()
    const { ctx, events, reset } = withEvents()
    ctx.signal = controller.signal
    ctx.onEvent = (e) => { events.push(e); if (e.step === 'anchor' && e.data?.status === 'running') controller.abort() }
    await expect(fetchAndAnchor(ctx, profile)).rejects.toMatchObject({ code: 'cancelled' })
    const record = [...ctx.store.files.entries()].find(([k]) => k.endsWith('run.json'))!
    expect(JSON.parse(record[1]).status).toBe('cancelled')
    expect(await ctx.store.exists(profilePaths('demo').latest)).toBe(false)
    ctx.signal = undefined
    reset()
    await fetchAndAnchor(ctx, profile)
    expect(stepsRun(events, 'reused')).toEqual(['search', 'fetch'])
    expect(stepsRun(events, 'running')).toEqual(['anchor', 'gate'])
  })
})

describe('errors say what to do', () => {
  it('an empty search is a failure unless allowed', async () => {
    const ctx = makeContext()
    const inner = ctx.ncbi.fetch
    ctx.ncbi = { ...ctx.ncbi, fetch: async (url, init) => (url.includes('esearch') ? { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { count: '0', idlist: [] } }) } : inner(url, init)) }
    const e = await fetchAndAnchor(ctx, profile).catch((x) => x)
    expect(e).toBeInstanceOf(EngineError)
    expect(e.code).toBe('empty-search')
    expect(e.action).toMatch(/Setup/)
    await expect(fetchAndAnchor(ctx, profile, { allowEmpty: true })).resolves.toBeTruthy()
  })
  it('a source failure keeps downloads and explains', async () => {
    const ctx = makeContext(() => true)
    const e = await fetchAndAnchor(ctx, profile).catch((x) => x)
    expect(e.code).toBe('source-failed')
    expect(e.action).toMatch(/already downloaded/)
  })
  it('panels with no records fail clearly', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    await expect(buildPanelFromRun(ctx, profile, { schemaVersion: 1, records: {} })).rejects.toMatchObject({ code: 'empty-panel' })
  })
  it('asks for a fetch before a panel', async () => {
    await expect(buildPanelFromRun(makeContext(), profile, curation2)).rejects.toMatchObject({ code: 'run-missing' })
  })
})

describe('artifacts and provenance', () => {
  it('traces a sample result all the way back to the search', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    await buildPanelFromRun(ctx, profile, curation2)
    const sample = await runSample(ctx, profile, mutate([10, 200, 450]), 'sample-1')
    const trace = await traceArtifact(ctx.store, sample.artifact)
    const chain: string[] = []
    for (let n: typeof trace | undefined = trace; n; n = n.inputs[0]) chain.push(n.type)
    expect(chain).toEqual(['sample-result', 'panel', 'gated-records', 'anchored-records', 'raw-records', 'accession-list'])
    expect(trace.tools.map((t) => t.name)).toContain('alignToReference')
    expect(sample.run.kind).toBe('sample')
    expect(sample.result?.findings.find((f) => f.group === 'a')?.status).toBe('consistent')
  })
  it('refuses the wrong type of artifact', async () => {
    const ctx = makeContext()
    const { run } = await fetchAndAnchor(ctx, profile)
    const gated = run.artifacts.find((a) => a.type === 'gated-records')!
    await expect(loadArtifact(ctx.store, { type: 'panel', key: gated.key })).rejects.toMatchObject({ code: 'artifact-missing' })
    const dir = (t: string) => `artifacts/${t}/${gated.key.replace('sha256:', '')}`
    ctx.store.files.set(`${dir('panel')}/manifest.json`, ctx.store.files.get(`${dir('gated-records')}/manifest.json`)!)
    await expect(loadArtifact(ctx.store, { type: 'panel', key: gated.key })).rejects.toMatchObject({ code: 'artifact-wrong-type' })
  })
  it('gives panel builds, samples and refused samples their own records', async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    const { run } = await buildPanelFromRun(ctx, profile, curation2)
    expect(run.kind).toBe('panel')
    const refused = await runSample(ctx, profile, randomSeq(400, 1234), 'wrong')
    expect(refused.result).toBeNull()
    expect(refused.run.status).toBe('succeeded')
  })
})

describe('panel dataset (roadmap stage 2)', () => {
  const curation: Curation = { schemaVersion: 1, records: {
    'A1.1': { group: 'a', provenanceClass: 'wild-documented', site: 's1' }, 'A2.1': { group: 'a', provenanceClass: 'wild-documented', site: 's2' },
    'B1.1': { group: 'b', provenanceClass: 'wild-documented', site: 's3' },
  } }
  const built = async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    await buildPanelFromRun(ctx, profile, curation)
    return { ctx, dir: profilePaths('demo').panel('p', '1') }
  }
  const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map((d) => d.code)

  it('a build writes examples with their answers, and a manifest of every file', async () => {
    const { ctx, dir } = await built()
    const examples = JSON.parse(ctx.store.files.get(`${dir}/examples.json`)!) as PanelExamples
    expect(examples.examples.map((e) => e.id)).toEqual(['member-a', 'member-b', 'fragment-a', 'control-not-marker'])
    expect(examples.examples.find((e) => e.id === 'member-a')!.expected).toMatchObject({ outcome: 'result', statuses: { a: 'consistent' } })
    expect(examples.examples.find((e) => e.id === 'control-not-marker')!.expected.outcome).toBe('refused')
    expect(examples.examples.find((e) => e.id === 'fragment-a')!.sequence).toHaveLength(300)
    const manifest = JSON.parse(ctx.store.files.get(`${dir}/dataset.json`)!) as DatasetManifest
    expect(Object.keys(manifest.files).sort()).toEqual(['README.md', 'diagnostics.json', 'examples.json', 'panel.fasta', 'panel.json', 'validation.json'])
    expect(manifest.builtWith).toEqual([{ name: 'onephylogeny-engine', version: ENGINE_VERSION }])
    const readme = ctx.store.files.get(`${dir}/README.md`)!
    expect(readme).toMatch(/^# p 1\n/)
    for (const h of ['## Groups', '## Limits', '## Checking a copy', '## Cite']) expect(readme).toContain(h)
    expect(readme).toContain('Not covered: Elsewhere')
    expect(readme).toContain('never proof of where an animal was collected')
    expect(readme).not.toMatch(/-?\d{1,3}\.\d{3,}/)
    expect(manifest.panel.checksum).toBe(examples.panel.checksum)
  })

  it('verifies a faithful copy', async () => {
    const { ctx, dir } = await built()
    const r = await verifyDataset(ctx.store, dir, loadPanel, testSample)
    expect(r.diagnostics).toEqual([])
    expect(r.checked).toEqual({ files: 6, examples: 4 })
  })

  it('catches an edited file, a missing file, and a broken seal', async () => {
    const { ctx, dir } = await built()
    ctx.store.files.set(`${dir}/validation.json`, ctx.store.files.get(`${dir}/validation.json`)!.replace('{', '{ '))
    expect(codes(await verifyDataset(ctx.store, dir, loadPanel, testSample))).toEqual(['file-changed'])
    ctx.store.files.set(`${dir}/README.md`, 'edited')
    expect(codes(await verifyDataset(ctx.store, dir, loadPanel, testSample))).toEqual(['file-changed', 'file-changed'])
    ctx.store.files.delete(`${dir}/diagnostics.json`)
    expect(codes(await verifyDataset(ctx.store, dir, loadPanel, testSample))).toContain('file-missing')
    const panel = JSON.parse(ctx.store.files.get(`${dir}/panel.json`)!)
    ctx.store.files.set(`${dir}/panel.json`, JSON.stringify({ ...panel, notCovered: [] }))
    expect(codes(await verifyDataset(ctx.store, dir, loadPanel, testSample))).toEqual(expect.arrayContaining(['file-changed', 'panel-changed']))
  })

  it('reruns the examples, so software that answers differently fails', async () => {
    const { ctx, dir } = await built()
    const flipped: typeof testSample = (s, id, b) => {
      const out = testSample(s, id, b)
      return out.result ? { ...out, result: { ...out.result, findings: out.result.findings.map((f) => ({ ...f, status: 'inconclusive' as const })) } } : out
    }
    const r = await verifyDataset(ctx.store, dir, loadPanel, flipped)
    expect(codes(r).filter((c) => c === 'example-changed')).toHaveLength(3)
    expect(r.diagnostics[0]!.message).toMatch(/gave .*inconclusive.*, not .*consistent/)
  })

  it('refuses examples made for another panel, and a folder without a manifest or examples', async () => {
    const { ctx, dir } = await built()
    const examples = JSON.parse(ctx.store.files.get(`${dir}/examples.json`)!) as PanelExamples
    const bundle = await loadPanel(ctx.store, dir)
    expect(checkExamples({ ...examples, panel: { ...examples.panel, checksum: 'other' } }, bundle, testSample).map((d) => d.code)).toEqual(['examples-wrong-panel'])
    expect(checkExamples({ ...examples, examples: [] }, bundle, testSample).map((d) => d.code)).toEqual(['no-examples'])
    ctx.store.files.delete(`${dir}/dataset.json`)
    ctx.store.files.delete(`${dir}/examples.json`)
    expect(codes(await verifyDataset(ctx.store, dir, loadPanel, testSample))).toEqual(['no-dataset-manifest', 'no-examples'])
  })

  it('a panel version keeps the examples it was published with', async () => {
    const { ctx, dir } = await built()
    const bundle = await loadPanel(ctx.store, dir)
    await expect(writeDataset(ctx.store, dir, bundle, testSample)).resolves.toBeTruthy()
    const changed = JSON.parse(ctx.store.files.get(`${dir}/examples.json`)!) as PanelExamples
    changed.examples[0]!.sequence = changed.examples[0]!.sequence.slice(1)
    ctx.store.files.set(`${dir}/examples.json`, JSON.stringify(changed))
    await expect(writeDataset(ctx.store, dir, bundle, testSample)).rejects.toMatchObject({ code: 'examples-differ' })
  })

  it('everything the engine writes fits the published JSON Schemas', async () => {
    const { ctx, dir } = await built()
    const sample = testSample(mutate([10, 200, 450], 0, 500), 's', await loadPanel(ctx.store, dir))
    const read = (f: string) => JSON.parse(ctx.store.files.get(`${dir}/${f}`)!)
    for (const [pkg, name, value] of [
      ['core', 'profile', profile], ['core', 'curation', curation], ['core', 'panel', read('panel.json')], ['core', 'result', sample.result],
      ['engine', 'examples', read('examples.json')], ['engine', 'dataset', read('dataset.json')],
    ] as const) {
      const v = validate(pkg, name)
      expect(v(value), `${name}: ${ajv.errorsText(v.errors)}`).toBe(true)
    }
  })

  it('the schemas refuse another version, an unknown field, a missing field and an unknown status', async () => {
    const { ctx, dir } = await built()
    const panel = JSON.parse(ctx.store.files.get(`${dir}/panel.json`)!) as Record<string, unknown>
    const v = validate('core', 'panel')
    expect(v(panel)).toBe(true)
    expect(v({ ...panel, schemaVersion: 3 })).toBe(false)
    expect(v({ ...panel, latitude: 1 })).toBe(false)
    const { groups: _groups, ...noGroups } = panel
    expect(v(noGroups)).toBe(false)
    const result = testSample(mutate([10, 200, 450], 0, 500), 's', await loadPanel(ctx.store, dir)).result!
    expect(validate('core', 'result')({ ...result, findings: [{ ...result.findings[0], status: 'probably' }] })).toBe(false)
  })

  it('chooses the same examples every time', async () => {
    const a = await built()
    const b = await built()
    expect(a.ctx.store.files.get(`${a.dir}/examples.json`)).toBe(b.ctx.store.files.get(`${b.dir}/examples.json`))
  })
})

describe('sample routing (roadmap stage 2)', () => {
  const curation: Curation = { schemaVersion: 1, records: {
    'A1.1': { group: 'a', provenanceClass: 'wild-documented', site: 's1' }, 'A2.1': { group: 'a', provenanceClass: 'wild-documented', site: 's2' },
    'B1.1': { group: 'b', provenanceClass: 'wild-documented', site: 's3' },
  } }
  const bundles = async () => {
    const ctx = makeContext()
    await fetchAndAnchor(ctx, profile)
    await buildPanelFromRun(ctx, profile, curation)
    const p = await loadPanel(ctx.store, profilePaths('demo').panel('p', '1'))
    // Another marker's panel: an unrelated reference, so nothing of this marker aligns to it.
    const other: typeof p = { ...p, panel: { ...p.panel, id: 'other-marker' }, referenceSequence: randomSeq(600, 4242) }
    const superseded: typeof p = { ...p, panel: { ...p.panel, id: 'old', status: 'superseded' } }
    return { p, other, superseded }
  }

  it('suggests the panel the sequence belongs to, first, and says why the others don\'t apply', async () => {
    const { p, other, superseded } = await bundles()
    const r = routeSample(mutate([10, 200, 450], 0, 500), [other, superseded, p])
    expect(r.map((s) => [s.panel.id, s.applies])).toEqual([['p', true], ['old', false], ['other-marker', false]])
    expect(r[0]!.reason).toMatch(/^Aligns at \d+\.\d% identity over \d+ columns, covering \d of \d windows$/)
    expect(r[0]!.windows.length).toBeGreaterThan(0)
    expect(r[1]!.reason).toMatch(/superseded/)
    expect(r[2]!.reason).toMatch(/different gene|reference/)
  })

  it('a suggested panel accepts the sequence, and a refused one would refuse it too', async () => {
    const { p, other } = await bundles()
    const seq = mutate([10, 200, 450], 0, 500)
    const [first] = routeSample(seq, [p])
    expect(first!.applies).toBe(true)
    expect(testSample(seq, 's', p).result).not.toBeNull()
    const junk = randomSeq(500, 77)
    expect(routeSample(junk, [p])[0]!.applies).toBe(false)
    expect(testSample(junk, 's', p).result).toBeNull()
    expect(routeSample(seq, [other])[0]!.applies).toBe(false)
  })

  it('a fragment outside every window is not suggested', async () => {
    const { p } = await bundles()
    const tiny = { ...p, panel: { ...p.panel, rules: { ...p.panel.rules, minSharedColumns: 10_000 } } }
    const [s] = routeSample(mutate([10, 200, 450], 0, 500), [tiny])
    expect(s).toMatchObject({ applies: false, windows: [] })
    expect(s!.reason).toMatch(/covers none of this panel's windows/)
  })

  it('checks a taxon claim when the sample carries one', async () => {
    const { p } = await bundles()
    const seq = mutate([10, 200, 450], 0, 500)
    expect(routeSample(seq, [p])[0]!.taxonMatches).toBe('unknown')
    expect(routeSample(seq, [p], { taxonClaim: { source: 'ncbi-taxonomy', id: '1' } })[0]).toMatchObject({ applies: true, taxonMatches: true })
    expect(routeSample(seq, [p], { taxonClaim: { source: 'ncbi-taxonomy', id: '999' } })[0]).toMatchObject({ applies: false, taxonMatches: false })
  })

  it('lists the newest version of a panel first when versions tie', async () => {
    const { p } = await bundles()
    const v = (version: string) => ({ ...p, panel: { ...p.panel, version } })
    expect(routeSample(mutate([10, 200, 450], 0, 500), [v('0.9.1'), v('0.10.0'), v('0.2.0')]).map((s) => s.panel.version)).toEqual(['0.10.0', '0.9.1', '0.2.0'])
  })

  it('ranks active panels above candidates', async () => {
    const { p } = await bundles()
    const candidate = { ...p, panel: { ...p.panel, id: 'cand', status: 'candidate' as const } }
    const active = { ...p, panel: { ...p.panel, id: 'act', status: 'active' as const } }
    expect(routeSample(mutate([10, 200, 450], 0, 500), [candidate, active]).map((s) => s.panel.id)).toEqual(['act', 'cand'])
  })
})

describe('run records for the curation sheet', () => {
  it('reads the latest run\'s records, and says when there is none', async () => {
    const ctx = makeContext()
    await expect(loadRunRecords(ctx.store, 'demo')).rejects.toMatchObject({ code: 'run-missing' })
    await fetchAndAnchor(ctx, profile)
    const records = await loadRunRecords(ctx.store, 'demo')
    expect(records.map((r) => r.version)).toEqual(expect.arrayContaining(['A1.1', 'A2.1', 'B1.1', 'B2.1', 'U1.1', 'W1.1']))
  })
})

describe('curation history (roadmap stage 3)', () => {
  const at = '2026-11-10T00:00:00.000Z'
  it('records each saved change, field by field, with who and why, and nothing when nothing changed', async () => {
    const store = memory()
    const P = profilePaths('demo')
    const first: Curation = { schemaVersion: 1, records: { 'A1.1': { group: 'a', site: 's1' } } }
    const e1 = await saveCuration(store, 'demo', first, { at, by: 'curator-1', reason: 'First pass' })
    expect(e1).toEqual({ at, by: 'curator-1', reason: 'First pass', changes: [{ record: 'A1.1', field: 'group', to: 'a' }, { record: 'A1.1', field: 'site', to: 's1' }] })
    expect(JSON.parse(store.files.get(P.curation)!)).toEqual(first)
    expect(await saveCuration(store, 'demo', first, { at })).toBeNull()
    const second: Curation = { schemaVersion: 1, records: { 'A1.1': { group: 'b' }, 'B1.1': { exclude: true } } }
    await saveCuration(store, 'demo', second, { at, reason: 'Paper says otherwise' })
    const { entries, damagedLines } = await readCurationHistory(store, 'demo')
    expect(damagedLines).toEqual([])
    expect(entries).toHaveLength(2)
    expect(entries[1]!.changes).toEqual([{ record: 'A1.1', field: 'group', from: 'a', to: 'b' }, { record: 'A1.1', field: 'site', from: 's1' }, { record: 'B1.1', field: 'exclude', to: true }])
    expect((await readCurationHistory(store, 'demo', 'B1.1')).entries).toEqual([{ at, reason: 'Paper says otherwise', changes: [{ record: 'B1.1', field: 'exclude', to: true }] }])
  })

  it('appends rather than rewrites when the store can, and reports a damaged line', async () => {
    const store = memory()
    const appended: string[] = []
    const appending = { ...store, append: async (p: string, t: string) => { appended.push(p); store.files.set(p, (store.files.get(p) ?? '') + t) } }
    await saveCuration(appending, 'demo', { schemaVersion: 1, records: { 'A1.1': { group: 'a' } } }, { at })
    expect(appended).toEqual([historyPath('demo')])
    store.files.set(historyPath('demo'), `${store.files.get(historyPath('demo'))}{not json\n`)
    expect((await readCurationHistory(store, 'demo')).damagedLines).toEqual([2])
  })
})
