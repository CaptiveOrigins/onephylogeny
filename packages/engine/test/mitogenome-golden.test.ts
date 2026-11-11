import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseGenBank, verifyBundle, type Curation, type Profile } from '@captiveorigins/onephylogeny-core'
import { buildPanelFromRun, EngineError, fetchAndAnchor, loadPanel, profilePaths, runSample, testSample, verifyDataset, type EngineContext, type Store } from '../src/index.js'

// Made-up records (scripts/mitogenome-fixture.mjs): a 1,500-base "mitogenome" with five genes, one on the minus strand,
// and a control region; north and south haplotypes turned to different starts. Replayed in place of NCBI, as golden.test.ts does.
const text = readFileSync(new URL('../../../fixtures/golden/mitogenome.gb', import.meta.url), 'utf8')
const blocks = text.split(/^\/\/\s*$/m).filter((b) => b.includes('LOCUS')).map((b) => `${b.trimStart()}//\n`)
const byVersion = new Map(blocks.map((b) => [parseGenBank(b)[0]!.version, b]))
const recordOf = (version: string) => parseGenBank(byVersion.get(version)!)[0]!

const memory = (): Store => {
  const files = new Map<string, string>()
  return { read: async (p) => { if (!files.has(p)) throw new Error(`missing ${p}`); return files.get(p)! }, write: async (p, t) => void files.set(p, t), exists: async (p) => files.has(p) }
}
const context = (records = byVersion): EngineContext => ({
  store: memory(),
  ncbi: {
    sleep: async () => {}, delayMs: 0,
    fetch: async (url, init) => {
      const p = new URLSearchParams(init!.body)
      if (url.includes('esearch')) return { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { count: String(records.size), idlist: [...records.keys()] } }) }
      return { ok: true, status: 200, text: async () => p.get('id')!.split(',').map((i) => records.get(i)!).join('') }
    },
  },
})

const profile: Profile = {
  schemaVersion: 1, id: 'mito', title: 'Mitogenome golden',
  selection: { id: 's', title: 'S', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'mitogenome', organelle: 'mitochondrion' }, outgroups: [], exclude: [], filters: {} },
  reference: { accession: 'ZZ900000.1', geneticCode: 2 },
  panel: { id: 'mito-panel', version: '1', groups: [{ id: 'n', label: 'North' }, { id: 's', label: 'South' }], notCovered: ['Made-up records only'], validatedScope: [], rules: { minSharedColumns: 100, minDepthPerColumn: 1, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 } },
}
const assign = (group: string, ...ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, { group, provenanceClass: 'wild-documented' as const, site: `${group}-${i}` }]))
const curation: Curation = { schemaVersion: 1, records: { ...assign('n', 'ZZ900001.1', 'ZZ900002.1', 'ZZ900003.1', 'ZZ900004.1'), ...assign('s', 'ZZ900005.1', 'ZZ900006.1', 'ZZ900007.1', 'ZZ900008.1') } }

describe('golden mitogenome run on made-up records', () => {
  it('turns circular records, checks genes, and builds a sealed panel whose windows are the genes', async () => {
    const ctx = context()
    const { outcomes, run } = await fetchAndAnchor(ctx, profile)
    expect(run.status).toBe('succeeded')
    expect(outcomes).toHaveLength(11)
    const of = (id: string) => outcomes.find((o) => o.record === id)!
    const codes = (id: string) => of(id).diagnostics.map((d) => d.code)

    // Rotation: every circular, complete record is turned, including the two stored on the other strand.
    for (const id of ['ZZ900002.1', 'ZZ900003.1', 'ZZ900004.1', 'ZZ900005.1', 'ZZ900006.1', 'ZZ900007.1', 'ZZ900008.1']) {
      expect(of(id).status).toBe('passed')
      expect(of(id).diagnostics.find((d) => d.code === 'rotated-to-reference')!.message).toMatch(/moved by \d+ bases/)
    }
    expect(of('ZZ900003.1').diagnostics.find((d) => d.code === 'rotated-to-reference')!.message).toMatch(/other strand/)
    expect(of('ZZ900001.1').diagnostics.find((d) => d.code === 'rotated-to-reference')!.message).toMatch(/already starts/)
    // Turned records line up column for column: the north records match the reference outside their own few changes.
    expect(of('ZZ900002.1').identity).toBeGreaterThan(0.99)
    expect(of('ZZ900003.1').identity).toBeGreaterThan(0.99)

    // A circular record whose start can't be found is excluded with the reason, never aligned on a guess.
    expect(of('ZZ900010.1')).toMatchObject({ status: 'excluded', columns: 0 })
    expect(codes('ZZ900010.1')).toEqual(['rotation-refused'])

    // A partial, linear record is aligned as it is; genes it covers only in part aren't judged.
    expect(of('ZZ900009.1').status).toBe('passed')
    expect(codes('ZZ900009.1')).not.toContain('rotated-to-reference')
    expect(of('ZZ900009.1').diagnostics.find((d) => d.code === 'gene-partial')!.message).toMatch(/COX1 \(0%\).*ND6/)

    // The frameshift is flagged on COX1 and described, not used to exclude.
    const shifted = of('ZZ900008.1')
    expect(shifted.status).toBe('passed')
    expect(shifted.diagnostics.filter((d) => d.code === 'gene-frame')).toEqual([expect.objectContaining({ severity: 'warning', path: 'genes.cox1', message: expect.stringMatching(/^COX1: 1 missing column/) })])
    expect(codes('ZZ900008.1')).not.toContain('frame-shifting-indel')
    // Extra bases in the control region are no frame problem, and no other record has a gene flagged.
    for (const o of outcomes.filter((o) => o.record !== 'ZZ900008.1')) expect(o.diagnostics.filter((d) => d.code === 'gene-frame' || d.code === 'gene-stops')).toEqual([])

    const built = await buildPanelFromRun(ctx, profile, curation)
    expect(built.published).toBe(true)
    expect(built.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const panel = built.bundle.panel
    // Windows are the reference's genes, in order, with ND6 on the minus strand. The control region isn't one.
    expect(panel.windows.map((w) => [w.label, w.start, w.end, w.gene?.kind, w.gene?.strand])).toEqual([
      ['trnF', 0, 66, 'trna', '+'], ['rrnS', 66, 306, 'rrna', '+'], ['COX1', 306, 663, 'cds', '+'], ['trnS', 663, 729, 'trna', '+'], ['ND6', 729, 1029, 'cds', '-'], ['CYTB', 1029, 1338, 'cds', '+'],
    ])
    expect(panel.notCovered[0]).toBe('Made-up records only')
    expect(panel.notCovered.join('\n')).toMatch(/control region.*1339\.\.1500.*left out by default/i)
    expect(panel.marker.kind).toBe('mitogenome')
    expect(panel.gates.frameErrors).toBe(false)
    expect(panel.gates.codonStart).toBeUndefined()
    expect(panel.pairs.some((p) => p.window === 'cytb' && p.state === 'resolvable')).toBe(true)

    // Sealed, and the copy on disk verifies, files and examples both.
    expect(verifyBundle(built.bundle)).toEqual([])
    const dir = profilePaths(profile.id).panel(panel.id, panel.version)
    expect((await loadPanel(ctx.store, dir)).panel.checksum).toBe(panel.checksum)
    expect((await verifyDataset(ctx.store, dir, loadPanel, testSample)).diagnostics.filter((d) => d.severity === 'error')).toEqual([])

    // A sample: the result's QC carries the per-gene checks, and a frameshift there is described without changing statuses.
    const north = await runSample(ctx, profile, recordOf('ZZ900001.1').sequence, 'north')
    expect(Object.fromEntries(north.result!.findings.map((f) => [f.group, f.status]))).toMatchObject({ n: 'consistent', s: 'excluded_within_panel' })
    expect(north.result!.qc!.genes!.map((g) => [g.label, g.status])).toEqual([['COX1', 'ok'], ['ND6', 'ok'], ['CYTB', 'ok']])
    expect(north.result!.qc!.rules.find((r) => r.rule === 'frame')!.status).toBe('good')

    // Samples aren't turned (only GenBank records say they're circular), so this one is given in the reference's frame:
    // ZZ900005.1 was turned by 700, and one CYTB base is dropped.
    const south = recordOf('ZZ900005.1').sequence
    const inFrame = south.slice(-700) + south.slice(0, -700)
    const s = await runSample(ctx, profile, inFrame.slice(0, 1100) + inFrame.slice(1101), 'south-shifted')
    expect(s.result).not.toBeNull()
    expect(s.result!.qc!.genes!.map((g) => [g.label, g.status])).toEqual([['COX1', 'ok'], ['ND6', 'ok'], ['CYTB', 'frame']])
    expect(s.result!.findings.find((f) => f.group === 's')!.status).toBe('consistent')
    expect(s.result!.qc!.rules.find((r) => r.rule === 'frame')!.status).toBe('bad')
    expect(s.diagnostics.some((d) => d.code === 'gene-frame')).toBe(true)
  }, 60_000)

  it('refuses to build a mitogenome panel when the reference has no usable gene annotation', async () => {
    const bare = new Map(byVersion)
    bare.set('ZZ900000.1', byVersion.get('ZZ900000.1')!.replace(/^ {5}(tRNA|rRNA|CDS|D-loop) .*\n( {21}\/.*\n)*/gm, ''))
    expect(parseGenBank(bare.get('ZZ900000.1')!)[0]!.features.map((f) => f.key)).toEqual(['source'])
    const ctx = context(bare)
    await fetchAndAnchor(ctx, profile)
    const failure = await buildPanelFromRun(ctx, profile, curation).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(EngineError)
    expect(failure).toMatchObject({ code: 'reference-unannotated', message: expect.stringMatching(/no usable gene annotation/) })
  }, 60_000)

  it('uses windows the profile gives, unchanged, and keeps its notCovered as written', async () => {
    const windows = [{ id: 'cytb-part', label: 'CYTB part', start: 1029, end: 1338 }]
    const own: Profile = { ...profile, panel: { ...profile.panel!, id: 'mito-own', windows } }
    const ctx = context()
    await fetchAndAnchor(ctx, own)
    const built = await buildPanelFromRun(ctx, own, curation)
    expect(built.bundle.panel.windows).toEqual(windows)
    expect(built.bundle.panel.notCovered).toEqual(['Made-up records only'])
  }, 60_000)
})
