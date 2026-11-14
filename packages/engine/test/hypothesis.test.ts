import { describe, expect, it } from 'vitest'
import type { Curation, Profile } from '@extantape/onephylogeny-core'
import { buildPanelFromRun, fetchAndAnchor, profilePaths, runHypothesis, runSample, testHypothesis, testHypothesisOnPanel, type EngineContext, type Store } from '../src/index.js'

// Hypothesis tests, engine side (ADR 0013). A made-up workspace built by the engine itself, offline: two groups, a
// panel built twice, and saved sample results. Every artifact carries its real recorded hashes, so the file checks are
// the store's own, never a value passed in.

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
const gb = (acc: string, seq: string) => `LOCUS       ${acc}  ${seq.length} bp DNA\nDEFINITION  gene x\nACCESSION   ${acc}\nVERSION     ${acc}.1\nFEATURES             Location/Qualifiers\n     source          1..${seq.length}\n                     /organism="Example taxon"\n                     /db_xref="taxon:1"\nORIGIN\n        1 ${seq.toLowerCase()}\n//\n`
const DB: Record<string, string> = {
  'R1.1': gb('R1', REF), 'A1.1': gb('A1', mutate([10, 200, 450])), 'A2.1': gb('A2', mutate([10, 200, 450, 300])), 'B1.1': gb('B1', mutate([20, 210, 460])),
}

/** Files in memory, with a folder listing, and a record of every write once `watch` is on. */
function memory(options: { folders?: boolean } = {}) {
  const files = new Map<string, string>()
  const writes: string[] = []
  let watching = false
  const store: Store = {
    read: async (p) => { const v = files.get(p); if (v === undefined) throw new Error(`no file ${p}`); return v },
    write: async (p, t) => { if (watching) writes.push(p); files.set(p, t) },
    append: async (p, t) => { if (watching) writes.push(p); files.set(p, (files.get(p) ?? '') + t) },
    exists: async (p) => files.has(p),
    ...(options.folders === false ? {} : {
      folders: async (dir: string) => [...new Set([...files.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1).split('/')).filter((parts) => parts.length > 1).map((parts) => parts[0]!))].sort(),
    }),
  }
  return { store, files, writes, watch: () => { watching = true } }
}

const profile: Profile = {
  schemaVersion: 1, id: 'demo', title: 'Demo',
  selection: { id: 's', title: 'S', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'gene', gene: 'x' }, outgroups: [], exclude: [], filters: { minLength: 100 } },
  reference: { accession: 'R1.1' },
  panel: { id: 'p', version: '1', groups: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], notCovered: ['Elsewhere'], validatedScope: [], rules: { minSharedColumns: 50, minDepthPerColumn: 1, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 } },
}
const v2: Profile = { ...profile, panel: { ...profile.panel!, version: '2' } }
const curation: Curation = { schemaVersion: 1, records: {
  'A1.1': { group: 'a', provenanceClass: 'wild-documented', site: 's1' }, 'A2.1': { group: 'a', provenanceClass: 'wild-documented', site: 's2' },
  'B1.1': { group: 'b', provenanceClass: 'wild-documented', site: 's3' },
} }
const LIKE_A = mutate([10, 200, 450], 0, 500)

/** A workspace with panel versions 1 and 2, sample-1 tested against both, and a refused sample against version 1. */
async function workspace(options: { folders?: boolean; secondVersion?: boolean } = {}) {
  const mem = memory(options)
  let tick = 0
  const ctx: EngineContext = {
    store: mem.store, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    ncbi: {
      sleep: async () => {}, delayMs: 0, retries: 0,
      fetch: async (url, init) => {
        if (url.includes('esearch')) return { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { count: '3', idlist: Object.keys(DB).filter((k) => k !== 'R1.1') } }) }
        const ids = new URLSearchParams(init!.body).get('id')!.split(',')
        return { ok: true, status: 200, text: async () => ids.map((i) => DB[i]!).join('') }
      },
    },
  }
  await fetchAndAnchor(ctx, profile)
  await buildPanelFromRun(ctx, profile, curation)
  const first = await runSample(ctx, profile, LIKE_A, 'sample-1')
  await runSample(ctx, profile, 'ACGT'.repeat(20), 'sample-3')
  if (options.secondVersion !== false) {
    await buildPanelFromRun(ctx, v2, curation)
    await runSample(ctx, v2, LIKE_A, 'sample-1')
  }
  // From here on, nothing the hypothesis test does may write.
  mem.watch()
  return { ...mem, ctx, first }
}

const P = profilePaths('demo')
const v = (version: string) => ({ id: 'p', version })

describe('testHypothesis and runHypothesis', () => {
  it('states the test from the store, then refutes a false claim, citing the saved result and the run that made it', async () => {
    const w = await workspace()
    const plan = await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-1', group: 'b', panel: v('1') })
    expect(plan.stated.testable).toBe(true)
    // The result is the artifact its run recorded, not the copy in results/; the panel is the one artifact.json names.
    expect(plan.stated.uses.map((u) => u.artifact)).toEqual([w.first.artifact, JSON.parse(w.files.get(`${P.panel('p', '1')}/artifact.json`)!)])
    expect(plan.stated.uses[0]!.run).toBe(w.first.run.id)
    expect(plan.sources.map((s) => s.kind)).toEqual(['result', 'panel'])
    const outcome = await runHypothesis(w.ctx, plan)
    expect(outcome.verdict).toBe('refuted')
    expect(outcome.citations[0]).toMatchObject({ artifact: w.first.artifact, run: w.first.run.id })
    expect(outcome.citations[0]!.path).toMatch(/^findings\.\d+$/)
    // The file hashes were checked here, so no caveat says they weren't.
    expect(outcome.caveats.join(' ')).not.toMatch(/file hashes weren't checked/)
    expect(outcome.notes).toEqual([])
    expect(w.writes).toEqual([])
  })

  it('does not refute a true claim, and says that is not confirmation', async () => {
    const w = await workspace()
    const outcome = await runHypothesis(w.ctx, await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-1', group: 'a', panel: v('1') }))
    expect(outcome.verdict).toBe('not refuted')
    expect(outcome.explanation).toMatch(/Not refuted isn't confirmed/)
    expect(w.writes).toEqual([])
  })

  it('never picks between panel versions: a claim that names none, with two holding results, is untestable', async () => {
    const w = await workspace()
    const plan = await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-1', group: 'a' })
    expect(plan.stated).toMatchObject({ testable: false, reason: 'sample-1 has results against 2 panel versions and the claim names none of them' })
    const distinct = await testHypothesis(w.ctx, profile, { kind: 'groups-distinct', a: 'a', b: 'b', window: 'whole' })
    expect(distinct.stated.reason).toBe('2 panels are loaded and the claim names none of them')
    const outcome = await runHypothesis(w.ctx, plan)
    expect(outcome.verdict).toBe('untestable with this data')
    expect(w.writes).toEqual([])
  })

  it('reads a panel pair for groups-distinct when the version is named', async () => {
    const w = await workspace()
    const outcome = await runHypothesis(w.ctx, await testHypothesis(w.ctx, profile, { kind: 'groups-distinct', a: 'a', b: 'b', window: 'whole', panel: v('2') }))
    expect(outcome.verdict).toBe('not refuted')
    expect(outcome.citations[0]!.path).toMatch(/^pairs\.\d+$/)
    expect(w.writes).toEqual([])
  })

  it('compares the call across two versions from their saved results', async () => {
    const w = await workspace()
    const outcome = await runHypothesis(w.ctx, await testHypothesis(w.ctx, profile, { kind: 'panel-changed-call', sample: 'sample-1', from: v('1'), to: v('2') }))
    // Same records and settings, so every status is the same: the claim that version 2 changed the call is refuted.
    expect(outcome.verdict).toBe('refuted')
    expect(outcome.citations).toHaveLength(2)
    expect(w.writes).toEqual([])
  })

  it('says a refused sample has no result, and why it was refused', async () => {
    const w = await workspace()
    const plan = await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-3', group: 'a' })
    expect(plan.stated).toMatchObject({ testable: false, reason: 'there is no saved result for sample-3' })
    expect(plan.notes.join(' ')).toMatch(/sample-3\.json has no result: the sample was refused \(/)
    expect((await runHypothesis(w.ctx, plan)).verdict).toBe('untestable with this data')
  })

  it('is a tool or data problem when a panel file is changed after the test was stated', async () => {
    const w = await workspace()
    const plan = await testHypothesis(w.ctx, profile, { kind: 'groups-distinct', a: 'a', b: 'b', window: 'whole', panel: v('1') })
    expect(plan.stated.testable).toBe(true)
    const fasta = `${P.panel('p', '1')}/panel.fasta`
    w.files.set(fasta, `${w.files.get(fasta)!}>extra\nACGT\n`)
    const outcome = await runHypothesis(w.ctx, plan)
    expect(outcome.verdict).toBe('tool or data problem')
    expect(outcome.diagnostics!.map((d) => d.code)).toContain('files-changed')
    expect(outcome.notes.join(' ')).toMatch(/doesn't match its seal/)
    expect(outcome.notes.join(' ')).toMatch(/panel\.fasta isn't the file panel artifact .* recorded/)
  })

  it('is a tool or data problem when the panel artifact itself was tampered with, even though the published copy is intact', async () => {
    const w = await workspace()
    const ref = JSON.parse(w.files.get(`${P.panel('p', '1')}/artifact.json`)!) as { key: string }
    const inStore = `artifacts/panel/${ref.key.replace('sha256:', '')}/panel.fasta`
    w.files.set(inStore, `${w.files.get(inStore)!}\n`)
    const outcome = await runHypothesis(w.ctx, await testHypothesis(w.ctx, profile, { kind: 'groups-distinct', a: 'a', b: 'b', window: 'whole', panel: v('1') }))
    expect(outcome.verdict).toBe('tool or data problem')
    expect(outcome.diagnostics!.map((d) => d.message).join(' ')).toMatch(/don't match their recorded hashes/)
  })

  it('is a tool or data problem when a saved result copy no longer matches the artifact its run recorded', async () => {
    const w = await workspace()
    const file = `${P.results}/p-1/sample-1.json`
    const saved = JSON.parse(w.files.get(file)!)
    saved.result.findings = saved.result.findings.map((f: { status: string }) => ({ ...f }))
    w.files.set(file, `${JSON.stringify(saved, null, 1)}\n`)
    const plan = await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-1', group: 'b', panel: v('1') })
    expect(plan.notes.join(' ')).toMatch(/this copy isn't the outcome sample-result .* recorded/)
    const outcome = await runHypothesis(w.ctx, plan)
    expect(outcome.verdict).toBe('tool or data problem')
    expect(outcome.diagnostics!.map((d) => d.code)).toEqual(['files-changed'])
  })

  it('is a tool or data problem when the run that made a result has no record of it', async () => {
    const w = await workspace()
    w.files.delete(`${P.run(w.first.run.id)}/run.json`)
    const outcome = await runHypothesis(w.ctx, await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-1', group: 'b', panel: v('1') }))
    expect(outcome.verdict).toBe('tool or data problem')
    expect(outcome.notes.join(' ')).toMatch(/has no record/)
  })

  it('is a tool or data problem when a result changes between stating and running', async () => {
    const w = await workspace()
    const plan = await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-1', group: 'b', panel: v('1') })
    const file = `${P.results}/p-1/sample-1.json`
    w.files.delete(file)
    const outcome = await runHypothesis(w.ctx, plan)
    expect(outcome.verdict).toBe('tool or data problem')
    expect(outcome.notes).toEqual([`The saved result ${file} is gone`])
    expect(outcome.diagnostics!.map((d) => d.code)).toEqual(['artifact-missing'])
  })

  it('without a folder listing, needs the claim to name its version and never guesses one', async () => {
    const w = await workspace({ folders: false, secondVersion: false })
    const unnamed = await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-1', group: 'b' })
    expect(unnamed.stated.reason).toBe("this store can't list the panel versions it holds, so the claim has to name one")
    const named = await runHypothesis(w.ctx, await testHypothesis(w.ctx, profile, { kind: 'sample-in-group', sample: 'sample-1', group: 'b', panel: v('1') }))
    expect(named.verdict).toBe('refuted')
    expect(w.writes).toEqual([])
  })

  it('tests a lone panel folder against its dataset.json, without the store its artifact.json points into', async () => {
    const w = await workspace({ secondVersion: false })
    // A store holding only the panel's folder, as a downloaded copy would be.
    const prefix = `${P.panel('p', '1')}/`
    const only = memory()
    for (const [k, text] of w.files) if (k.startsWith(prefix)) only.files.set(`copy/${k.slice(prefix.length)}`, text)
    only.watch()
    const ctx = { ...w.ctx, store: only.store }
    const outcome = await runHypothesis(ctx, await testHypothesisOnPanel(ctx, 'copy', { kind: 'groups-distinct', a: 'a', b: 'b', window: 'whole' }))
    expect(outcome.verdict).toBe('not refuted')
    expect(outcome.notes).toEqual([])
    const sample = await testHypothesisOnPanel(ctx, 'copy', { kind: 'sample-in-group', sample: 'sample-1', group: 'a' })
    expect(sample.notes).toContain('A panel folder holds no saved results; give a workspace and profile to test claims about a sample')
    only.files.set('copy/panel.fasta', `${only.files.get('copy/panel.fasta')!}>x\nACGT\n`)
    const tampered = await runHypothesis(ctx, await testHypothesisOnPanel(ctx, 'copy', { kind: 'groups-distinct', a: 'a', b: 'b', window: 'whole' }))
    expect(tampered.verdict).toBe('tool or data problem')
    expect(only.writes).toEqual([])
  })
})
