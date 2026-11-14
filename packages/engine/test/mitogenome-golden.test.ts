import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseGenBank, reportMarkdown, sampleReport, verifyBundle, type Curation, type Profile } from '@extantape/onephylogeny-core'
import { buildPanelFromRun, buildTree, EngineError, fetchAndAnchor, loadPanel, profilePaths, routeSample, runSample, testSample, verifyDataset, type EngineContext, type Store } from '../src/index.js'

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

  it('partitions a mitogenome tree by gene and codon position, and a cytb-style tree stays unpartitioned', async () => {
    const ctx = context()
    const withTree: Profile = { ...profile, tree: { model: 'MFP', bootstrap: 1000, shAlrt: 1000, seed: 1, threads: 1 } }
    await fetchAndAnchor(ctx, withTree)
    const calls: { args: string[]; cwd: string }[] = []
    // A fake IQ-TREE: records how it was called and writes a tree where the engine expects it (the store is in memory).
    const fake = (store: Store) => ({
      version: async () => 'IQ-TREE 3 (fake)',
      run: async (_tool: string, args: string[], { cwd }: { cwd: string }) => {
        calls.push({ args, cwd })
        const dir = cwd.replace(/^\/abs\//, '')
        await store.write(`${dir}/tree.treefile`, '((H0001,H0002),(H0003,H0004));')
        await store.write(`${dir}/tree.iqtree`, 'fake report')
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    const tree = await buildTree({ ...ctx, tools: fake(ctx.store) }, withTree, { absoluteDir: '/abs', minCoverage: 0.5 })
    expect(tree.newick).toContain('(')
    const args = calls[0]!.args
    expect(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2)).toEqual(['-p', 'partitions.nex'])
    const nexus = await ctx.store.read(`${calls[0]!.cwd.replace(/^\/abs\//, '')}/partitions.nex`)
    expect(nexus).toMatch(/^#nexus\nbegin sets;/)
    expect(nexus).toMatch(/charset \w+_pos1 = /)
    expect(nexus).toContain('charset noncoding = ')

    calls.length = 0
    const whole: Profile = { ...withTree, tree: { ...withTree.tree!, partitions: 'none' } }
    await buildTree({ ...ctx, tools: fake(ctx.store) }, whole, { absoluteDir: '/abs', minCoverage: 0.5 })
    expect(calls[0]!.args).not.toContain('-p')
  }, 60_000)
})

describe('summary across genes and routing (ADR 0009, decisions 5 and 6), on made-up records', () => {
  // A cytb panel built from the same made-up records: the reference's CYTB annotation is the marker, and each whole
  // record has CYTB cut out by similarity, as for any unannotated mitogenome.
  const cytbProfile: Profile = {
    ...profile, id: 'cytb', title: 'Cytb from the same records',
    selection: { ...profile.selection, marker: { kind: 'gene', gene: 'CYTB', synonyms: ['cytb'], organelle: 'mitochondrion' } },
    reference: { accession: 'ZZ900000.1', geneticCode: 2 },
    panel: { ...profile.panel!, id: 'cytb-panel', rules: { ...profile.panel!.rules, minSharedColumns: 100 } },
  }
  const panels = async () => {
    const ctx = context()
    await fetchAndAnchor(ctx, profile)
    const mito = (await buildPanelFromRun(ctx, profile, curation)).bundle
    await fetchAndAnchor(ctx, cytbProfile)
    const cytb = (await buildPanelFromRun(ctx, cytbProfile, curation)).bundle
    return { mito, cytb }
  }

  // Built once: both panels come from the same made-up records and don't change between tests.
  let built: ReturnType<typeof panels> | undefined
  const both = () => (built ??= panels())
  const north = () => recordOf('ZZ900001.1').sequence
  // ZZ900005.1 (South) was turned by 700; given here in the reference's frame, as samples are.
  const southInFrame = () => { const s = recordOf('ZZ900005.1').sequence; return s.slice(-700) + s.slice(0, -700) }

  it('a mitogenome result lays the genes side by side, counts only, and the report shows it in its own section', async () => {
    const { mito } = await both()
    const r = testSample(north(), 'north', mito).result!
    // trnF and trnS are 66 columns, under the panel's minimum of 100 shared columns, so they aren't compared.
    expect(r.geneSummary).toMatchObject({ geneWindows: 6, comparedWindows: 4, columns: 309 + 357 + 300 + 240, queryColumns: 1206, disagreeing: [] })
    expect(r.geneSummary!.windows.map((w) => [w.label, w.withinSpread, w.nearest])).toEqual([['rrnS', ['n'], ['n']], ['COX1', ['n'], ['n']], ['ND6', ['n'], ['n']], ['CYTB', ['n'], ['n']]])
    expect(r.geneSummary!.nearest).toEqual([{ group: 'n', windows: ['rrns', 'cox1', 'nd6', 'cytb'] }])
    const report = sampleReport(mito.panel, r)
    expect(report.genes!.summary.slice(0, 3)).toEqual([
      'Compared in 4 of 6 genes, over 1206 reference columns (a column in two overlapping genes counted once). This sequence has a base at 1206 of them.',
      'Nearest group in each gene, by differences per shared column: North in 4 genes (rrnS, COX1, ND6, CYTB).',
      'The compared genes don\'t disagree: each shares a nearest group with every other.',
    ])
    expect(reportMarkdown(report)).toContain('## Across genes')
    expect(JSON.stringify(r.geneSummary)).not.toMatch(/probab|score|likel/i)
  }, 60_000)

  it('names the genes that disagree when one gene points elsewhere, without changing a status', async () => {
    const { mito } = await both()
    // North everywhere except CYTB, which is South's.
    const chimera = north().slice(0, 1029) + southInFrame().slice(1029, 1338) + north().slice(1338)
    const r = testSample(chimera, 'chimera', mito).result!
    expect(r.geneSummary!.nearest).toEqual([{ group: 'n', windows: ['rrns', 'cox1', 'nd6'] }, { group: 's', windows: ['cytb'] }])
    expect(r.geneSummary!.disagreeing).toEqual(['rrns', 'cox1', 'nd6', 'cytb'])
    expect(r.geneSummary!.windows.find((w) => w.window === 'cytb')).toMatchObject({ withinSpread: ['s'], nearest: ['s'] })
    const report = sampleReport(mito.panel, r)
    expect(report.genes!.summary).toContain('Nearest group in each gene, by differences per shared column: North in 3 genes (rrnS, COX1, ND6); South in 1 gene (CYTB).')
    expect(report.genes!.summary).toContain('These genes point to different nearest groups: rrnS, COX1, ND6, CYTB.')
    // The statuses are the per-window rules' own; the summary only describes beside them.
    const { geneSummary: _summary, ...rest } = r
    const again = testSample(chimera, 'chimera', mito).result!
    expect(again.findings).toEqual(rest.findings)
    expect(report.conflicts.some((c) => /point to different groups/.test(c))).toBe(true)
  }, 60_000)

  it('a cytb result has no summary key and its report no section', async () => {
    const { cytb } = await both()
    const cut = north().slice(1029, 1338)
    const out = testSample(cut, 'north-cytb', cytb)
    expect(out.diagnostics.map((d) => d.code)).not.toContain('marker-located')
    expect(Object.keys(out.result!)).toEqual(['schemaVersion', 'query', 'querySha256', 'producedBy', 'panel', 'run', 'overlap', 'findings', 'pairs', 'candidatesNotEvaluated', 'novelty', 'outOfValidatedScope', 'caveats', 'qc'])
    const report = sampleReport(cytb.panel, out.result!)
    expect('genes' in report).toBe(false)
    expect(reportMarkdown(report)).not.toContain('Across genes')
  }, 60_000)

  it('routes a whole mitogenome to both its mitogenome panel and a cytb panel, saying why each applies', async () => {
    const { mito, cytb } = await both()
    const r = routeSample(north(), [cytb, mito])
    expect(r.map((s) => [s.panel.id, s.applies, s.marker])).toEqual([['mito-panel', true, 'mitogenome'], ['cytb-panel', true, 'CYTB']])
    expect(r[0]).toMatchObject({ windows: ['rrns', 'cox1', 'nd6', 'cytb'], windowColumns: 1206, taxonMatches: 'unknown' })
    expect(r[0]!.located).toBeUndefined()
    expect(r[0]!.reason).toMatch(/^Aligns at 99\.\d% identity over 1500 columns, covering 4 of 6 genes \(1206 reference columns\)$/)
    // CYTB is reference bases 1030 to 1338; the cut keeps a few flanking bases, which the aligner trims.
    const place = r[1]!.located!
    expect(place.strand).toBe('+')
    expect(place.start).toBeLessThanOrEqual(1029)
    expect(place.end).toBeGreaterThanOrEqual(1338)
    expect(place.end - place.start).toBeLessThanOrEqual(309 + 2 * 30)
    expect(r[1]).toMatchObject({ windows: ['whole'], alignedColumns: 309 })
    expect(r[1]!.windowColumns).toBeUndefined()
    expect(r[1]!.reason).toMatch(/^CYTB found in bases \d+ to \d+ of the sample \(with up to 30 flanking bases each side\)\. Aligns at 100\.0% identity over 309 columns, covering 1 of 1 windows$/)
    expect(JSON.stringify(r)).not.toMatch(/probab|score|likel/i)

    // A suggested panel accepts the sequence: the cytb panel tests only the cut-out part, and says so.
    const out = testSample(north(), 'north', cytb)
    expect(out.result).not.toBeNull()
    expect(out.diagnostics[0]).toMatchObject({ severity: 'info', code: 'marker-located' })
    expect(out.result!.caveats).toContain(out.diagnostics[0]!.message)
    expect(Object.fromEntries(out.result!.findings.map((f) => [f.group, f.status]))).toEqual({ n: 'consistent', s: 'excluded_within_panel' })
    expect(out.result!.geneSummary).toBeUndefined()

    // A taxon claim is checked against both, and said.
    const claimed = routeSample(north(), [mito, cytb], { taxonClaim: { source: 'ncbi-taxonomy', id: '1' } })
    for (const s of claimed) {
      expect(s).toMatchObject({ applies: true, taxonMatches: true })
      expect(s.reason).toMatch(/, for the taxon the sample is recorded as$/)
    }
    expect(routeSample(north(), [mito, cytb], { taxonClaim: { source: 'ncbi-taxonomy', id: '2' } }).map((s) => s.applies)).toEqual([false, false])
  }, 60_000)

  it('a cytb sample gets the cytb panel as given, and the mitogenome panel for the one gene it covers', async () => {
    const { mito, cytb } = await both()
    const r = routeSample(north().slice(1029, 1338), [mito, cytb])
    const by = Object.fromEntries(r.map((s) => [s.panel.id, s]))
    expect(by['cytb-panel']).toMatchObject({ applies: true, windows: ['whole'] })
    expect(by['cytb-panel']!.located).toBeUndefined()
    expect(by['mito-panel']).toMatchObject({ applies: true, windows: ['cytb'], windowColumns: 309 })
    expect(by['mito-panel']!.reason).toMatch(/covering 1 of 6 genes \(309 reference columns\)$/)
  }, 60_000)

  it('refuses a cytb panel when the marker matches two places in the sample, never guessing', async () => {
    const { cytb } = await both()
    const twice = north() + north().slice(1029, 1338)
    const [s] = routeSample(twice, [cytb])
    expect(s).toMatchObject({ applies: false, windows: [] })
    expect(s!.reason).toBe('CYTB matches 2 places in this sample, so which one to test is ambiguous')
    const out = testSample(twice, 'twice', cytb)
    expect(out.result).toBeNull()
    expect(out.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'marker-in-many-places' })])
  }, 60_000)
})
