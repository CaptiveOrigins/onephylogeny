import {
  alignToReference, assessAlignment, buildPanel, collapseHaplotypes, DEFAULT_GATES, evaluateQuery, extractLocation, findGeneFeatures, leaveOneBlockOut, leaveOneGroupOut, parseFasta, parseGenBank,
  sha256Hex, canonicalJson, toRecordSheet, toSequenceRecord, validatePanel, validateProfile, validateResult, writeFasta,
  type Curation, type Diagnostic, type GateSettings, type GenBankRecord, type Panel, type PanelBundle, type PanelMember, type Profile, type Result, type Run, type RunEvent, type SequenceRecord, type Snapshot, type ValidationReport,
} from '@captiveorigins/onephylogeny-core'
import { NcbiClient, selectionQuery, type NcbiOptions } from '@captiveorigins/onephylogeny-acquire'

/** Where files live. A folder on disk, in the CLI and the Mac app. */
export interface Store {
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
}

/** How native programs run. Only tree building needs one. */
export interface ToolRunner {
  version(tool: string): Promise<string | null>
  run(tool: string, args: string[], options: { cwd: string }): Promise<{ code: number; stdout: string; stderr: string }>
}

export type EngineContext = {
  store: Store
  ncbi: Omit<NcbiOptions, 'log'>
  tools?: ToolRunner
  now?: () => Date
  onEvent?: (event: RunEvent) => void
}

export class RunError extends Error {}

const paths = (profileId: string) => ({
  profile: `profiles/${profileId}/profile.json`,
  curation: `profiles/${profileId}/curation.json`,
  latest: `profiles/${profileId}/latest-run.txt`,
  run: (id: string) => `profiles/${profileId}/runs/${id}`,
  panel: (id: string, version: string) => `profiles/${profileId}/panels/${id}-${version}`,
  results: `profiles/${profileId}/results`,
})
export const profilePaths = paths

const cachePath = (version: string) => `cache/genbank/${version.replace(/[^A-Za-z0-9._-]/g, '_')}.gb`

/** Writes the event log as the run goes, so a crash still leaves a record. */
class RunLog {
  readonly events: RunEvent[] = []
  private pending = Promise.resolve()
  constructor(private readonly ctx: EngineContext, private readonly file: string) {}
  private stamp() { return (this.ctx.now?.() ?? new Date()).toISOString() }
  add(level: RunEvent['level'], step: string, message: string, data?: Record<string, unknown>) {
    const event: RunEvent = { at: this.stamp(), level, step, message, ...(data ? { data } : {}) }
    this.events.push(event)
    this.ctx.onEvent?.(event)
    const text = `${this.events.map((e) => JSON.stringify(e)).join('\n')}\n`
    this.pending = this.pending.then(() => this.ctx.store.write(this.file, text))
  }
  flush() { return this.pending }
}

const runId = (ctx: EngineContext) => (ctx.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`
const hash = (s: string) => `sha256:${sha256Hex(s)}`

export type RecordOutcome = { record: string; organism?: string; status: 'passed' | 'excluded'; diagnostics: Diagnostic[]; columns: number; identity: number; extractedFrom: 'annotation' | 'whole-record' }

export type FetchOutcome = { run: Run; records: SequenceRecord[]; outcomes: RecordOutcome[] }

function geneSequence(rec: GenBankRecord, profile: Profile): { sequence: string; from: RecordOutcome['extractedFrom'] } {
  const marker = profile.selection.marker
  const names = [marker.gene, ...(marker.synonyms ?? []), ...(marker.products ?? [])].filter(Boolean) as string[]
  if (marker.kind === 'gene') {
    const feature = findGeneFeatures(rec, names)[0]
    if (feature) {
      try {
        return { sequence: extractLocation(rec.sequence, feature.location), from: 'annotation' }
      } catch { /* an unusual location falls back to the whole record, which the aligner clips */ }
    }
  }
  return { sequence: rec.sequence, from: 'whole-record' }
}

/**
 * Fetches everything a profile selects, keeps raw files, anchors each record to the reference, and writes the
 * record sheet, gate outcomes and run log. Writes are per record, so an interrupted run resumes from its cache.
 */
export async function fetchAndAnchor(ctx: EngineContext, profile: Profile, options: { batchSize?: number } = {}): Promise<FetchOutcome> {
  const errors = validateProfile(profile).filter((d) => d.severity === 'error')
  if (errors.length) throw new RunError(`The profile can't run: ${errors.map((e) => e.message).join('; ')}`)
  if (!profile.reference) throw new RunError('The profile needs a reference accession to anchor records to')
  const P = paths(profile.id)
  const id = runId(ctx)
  const dir = P.run(id)
  const log = new RunLog(ctx, `${dir}/events.jsonl`)
  const run: Run = { schemaVersion: 1, id, profile, tools: [], status: 'running', startedAt: (ctx.now?.() ?? new Date()).toISOString(), events: [], outputs: [], diagnostics: [] }
  const client = new NcbiClient({ ...ctx.ncbi, log: (level, message, data) => log.add(level, 'ncbi', message, data) })
  const finish = async (status: Run['status']) => {
    await log.flush()
    run.status = status
    run.finishedAt = (ctx.now?.() ?? new Date()).toISOString()
    run.events = log.events
    await ctx.store.write(`${dir}/run.json`, json(run))
    await ctx.store.write(P.latest, id)
  }
  try {
    const term = selectionQuery(profile.selection)
    log.add('info', 'search', 'Searching NCBI', { term })
    const found = await client.searchAccessions(term)
    const extra = [profile.reference.accession, ...profile.selection.outgroups.map((o) => o.accession).filter((a): a is string => Boolean(a))]
    const excluded = new Map(profile.selection.exclude.map((e) => [e.accession, e.reason]))
    const wanted = [...new Set([...found, ...extra])]
    log.add('info', 'search', `Found ${found.length} records, plus ${extra.length} named in the profile`, { found: found.length })

    const texts = new Map<string, string>()
    const missing: string[] = []
    for (const version of wanted) {
      const path = cachePath(version)
      if (await ctx.store.exists(path)) texts.set(version, await ctx.store.read(path))
      else missing.push(version)
    }
    log.add('info', 'fetch', `${texts.size} records already cached, ${missing.length} to download`)
    const batchSize = options.batchSize ?? 100
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize)
      const { text, records } = await client.fetchGenBankText(batch)
      const blocks = text.split(/^\/\/\s*$/m).filter((b) => b.includes('LOCUS'))
      for (const [n, rec] of records.entries()) {
        const raw = `${blocks[n]!.trimStart()}//\n`
        const key = rec.version || rec.accession
        await ctx.store.write(cachePath(key), raw)
        texts.set(key, raw)
      }
      log.add('info', 'fetch', `Downloaded ${Math.min(i + batchSize, missing.length)} of ${missing.length}`)
    }
    const parsed = new Map<string, GenBankRecord>()
    for (const [version, text] of texts) {
      const rec = parseGenBank(text)[0]
      if (!rec) throw new RunError(`The cached file for ${version} has no record in it`)
      parsed.set(rec.version || version, rec)
    }
    const refRec = [...parsed.values()].find((r) => r.version === profile.reference!.accession || r.accession === profile.reference!.accession)
    if (!refRec) throw new RunError(`The reference ${profile.reference.accession} was not retrieved`)
    const reference = geneSequence(refRec, profile).sequence
    log.add('info', 'anchor', `Reference ${refRec.version}: ${reference.length} columns`)
    await ctx.store.write(`${dir}/reference.fasta`, writeFasta([{ id: refRec.version, sequence: reference }]))

    const gates: GateSettings = { ...DEFAULT_GATES, ...(profile.reference.codonStart !== undefined ? { codonStart: profile.reference.codonStart } : {}), ...(profile.reference.geneticCode ? { geneticCode: profile.reference.geneticCode } : {}) }
    const records: SequenceRecord[] = []
    const outcomes: RecordOutcome[] = []
    const aligned: { id: string; sequence: string }[] = []
    const filters = profile.selection.filters
    for (const rec of parsed.values()) {
      const key = rec.version || rec.accession
      const sr = toSequenceRecord(rec)
      records.push(sr)
      const { sequence, from } = geneSequence(rec, profile)
      const a = alignToReference(sequence, reference)
      const diagnostics = assessAlignment(a, gates)
      const ambiguous = (sequence.match(/[^ACGTacgt]/g) ?? []).length
      const fail = (code: string, message: string) => diagnostics.push({ severity: 'error', code, message })
      if (excluded.has(key) || excluded.has(rec.accession)) fail('excluded-by-profile', excluded.get(key) ?? excluded.get(rec.accession)!)
      if (filters.minLength !== undefined && sequence.length < filters.minLength) fail('too-short', `${sequence.length} bp is under the minimum of ${filters.minLength}`)
      if (filters.maxLength !== undefined && sequence.length > filters.maxLength) fail('too-long', `${sequence.length} bp is over the maximum of ${filters.maxLength}`)
      if (filters.maxAmbiguous !== undefined && ambiguous > filters.maxAmbiguous) fail('too-ambiguous', `${ambiguous} ambiguous bases is over the maximum of ${filters.maxAmbiguous}`)
      if (rec.definition.startsWith('UNVERIFIED')) fail('unverified', 'NCBI marks this record UNVERIFIED')
      const passed = !diagnostics.some((d) => d.severity === 'error')
      outcomes.push({ record: key, ...(rec.organism ? { organism: rec.organism } : {}), status: passed ? 'passed' : 'excluded', diagnostics, columns: a ? a.matches + a.mismatches : 0, identity: a?.identity ?? 0, extractedFrom: from })
      if (a && passed) aligned.push({ id: key, sequence: a.aligned })
    }
    const pass = outcomes.filter((o) => o.status === 'passed').length
    log.add('info', 'gates', `${pass} records passed, ${outcomes.length - pass} excluded`)
    const counts = new Map<string, number>()
    for (const o of outcomes) for (const d of o.diagnostics) counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
    for (const [code, n] of counts) log.add('info', 'gates', `${code}: ${n}`)

    const snapshot: Snapshot = {
      schemaVersion: 1, id, createdAt: run.startedAt, sources: [{ name: 'NCBI nuccore', query: term, retrievedAt: run.startedAt }], records,
      rawFiles: records.map((r) => ({ path: cachePath(r.version || r.accession), sha256: hash(texts.get(r.version || r.accession) ?? '') })),
    }
    snapshot.checksum = hash(canonicalJson(snapshot))
    run.snapshot = { id, checksum: snapshot.checksum }
    const write = async (name: string, text: string) => {
      await ctx.store.write(`${dir}/${name}`, text)
      run.outputs.push({ path: name, sha256: hash(text) })
    }
    await write('snapshot.json', json(snapshot))
    await write('records.csv', toRecordSheet(records))
    await write('outcomes.json', json(outcomes))
    await write('aligned.fasta', writeFasta(aligned))
    await finish('succeeded')
    return { run, records, outcomes }
  } catch (e) {
    log.add('error', 'run', e instanceof Error ? e.message : String(e))
    await finish('failed')
    throw e
  }
}

export type PanelBuildOutcome = { bundle: PanelBundle; diagnostics: Diagnostic[]; validation: { blocks: ValidationReport; groups: ValidationReport }; unassigned: number }

/** Builds and validates a candidate panel from a finished run and the curation file. */
export async function buildPanelFromRun(ctx: EngineContext, profile: Profile, curation: Curation, id?: string): Promise<PanelBuildOutcome> {
  if (!profile.panel) throw new RunError('The profile has no panel settings')
  const P = paths(profile.id)
  const latest = id ?? (await ctx.store.read(P.latest)).trim()
  const dir = P.run(latest)
  const snapshot = JSON.parse(await ctx.store.read(`${dir}/snapshot.json`)) as Snapshot
  const aligned = parseFasta(await ctx.store.read(`${dir}/aligned.fasta`))
  const reference = parseFasta(await ctx.store.read(`${dir}/reference.fasta`))[0]!
  const byId = new Map(snapshot.records.map((r) => [r.version, r]))
  const groupIds = new Set(profile.panel.groups.map((g) => g.id))
  const members: (PanelMember & { block?: string })[] = []
  let unassigned = 0
  const diagnostics: Diagnostic[] = []
  for (const e of aligned) {
    const decision = curation.records[e.id]
    if (decision?.exclude) continue
    if (!decision?.group) { unassigned++; continue }
    if (!groupIds.has(decision.group)) { diagnostics.push({ severity: 'error', code: 'unknown-group', message: `${e.id} names group ${decision.group}, which isn't in the panel settings`, ids: [e.id] }); continue }
    members.push({
      record: e.id, group: decision.group, aligned: e.sequence,
      provenanceClass: decision.provenanceClass ?? byId.get(e.id)?.provenanceClass ?? 'unknown',
      ...(decision.use ? { use: decision.use } : {}),
      ...(decision.site ? { block: decision.site } : {}),
    })
  }
  const input = {
    settings: profile.panel,
    taxa: profile.selection.taxa,
    marker: profile.selection.marker,
    reference: { accession: reference.id, length: reference.sequence.length, ...(profile.reference?.codonStart !== undefined ? { codonStart: profile.reference.codonStart } : {}), ...(profile.reference?.geneticCode ? { geneticCode: profile.reference.geneticCode } : {}) },
    sources: [...new Map(snapshot.records.filter((r) => members.some((m) => m.record === r.version)).flatMap((r) => r.publications).filter((p) => p.title).map((p) => [p.title!, { citation: [p.authors, p.title, p.journal].filter(Boolean).join('. ') }])).values()],
    builtBy: latest,
    referenceSequence: reference.sequence,
  }
  const bundle = buildPanel({ ...input, members })
  diagnostics.push(...validatePanel(bundle.panel))
  const validation = { blocks: leaveOneBlockOut({ ...input, members }), groups: leaveOneGroupOut({ ...input, members }) }
  const out = P.panel(bundle.panel.id, bundle.panel.version)
  await ctx.store.write(`${out}/panel.json`, json(bundle.panel))
  await ctx.store.write(`${out}/panel.fasta`, writeFasta([{ id: '__reference__', sequence: reference.sequence }, ...Object.entries(bundle.sequences).map(([k, sequence]) => ({ id: k, sequence }))]))
  await ctx.store.write(`${out}/validation.json`, json(validation))
  await ctx.store.write(`${out}/diagnostics.json`, json({ diagnostics, unassigned }))
  return { bundle, diagnostics, validation, unassigned }
}

export async function loadPanel(store: Store, dir: string): Promise<PanelBundle> {
  const panel = JSON.parse(await store.read(`${dir}/panel.json`)) as Panel
  const fasta = parseFasta(await store.read(`${dir}/panel.fasta`))
  const referenceSequence = fasta.find((f) => f.id === '__reference__')?.sequence
  return { panel, sequences: Object.fromEntries(fasta.filter((f) => f.id !== '__reference__').map((f) => [f.id, f.sequence])), ...(referenceSequence ? { referenceSequence } : {}) }
}

export type SampleOutcome = { result: Result; diagnostics: Diagnostic[]; aligned: string; insertions: number; deletions: number; identity: number; clipped: { start: number; end: number } } | { result: null; diagnostics: Diagnostic[] }

/** Tests one local sequence against one panel. Pure TypeScript: runs in the app, the CLI or a hosted site. */
export function testSample(sequence: string, queryId: string, bundle: PanelBundle, thresholds: NonNullable<Profile['panel']>['thresholds'], options: { runId?: string } = {}): SampleOutcome {
  if (!bundle.referenceSequence) throw new RunError('This panel has no reference sequence')
  const a = alignToReference(sequence, bundle.referenceSequence)
  const r = bundle.panel.reference
  const diagnostics = assessAlignment(a, { ...DEFAULT_GATES, ...(r.codonStart !== undefined ? { codonStart: r.codonStart } : {}), ...(r.geneticCode ? { geneticCode: r.geneticCode } : {}) })
  if (!a || diagnostics.some((d) => d.severity === 'error')) return { result: null, diagnostics }
  const result = evaluateQuery(a.aligned, bundle, {
    thresholds, queryId, runId: options.runId ?? 'sample',
    caveats: ['Thresholds are configured values and these statuses are not probabilities', ...diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)],
  })
  diagnostics.push(...validateResult(result, bundle.panel))
  return { result, diagnostics, aligned: a.aligned, insertions: a.insertions.reduce((s, x) => s + x.length, 0), deletions: a.deletions.reduce((s, x) => s + x.length, 0), identity: a.identity, clipped: a.clipped }
}

export type TreeOutcome = { tool: string; version: string; newick: string; tips: { id: string; members: string[] }[]; log: string }

/** Builds a tree with IQ-TREE from one coverage window of a run's aligned records. Requires a tool runner. */
export async function buildTree(ctx: EngineContext, profile: Profile, options: { runId?: string; absoluteDir: string; tool?: string; window?: { start: number; end: number }; minCoverage?: number }): Promise<TreeOutcome> {
  if (!ctx.tools) throw new RunError('Building a tree needs a tool runner')
  if (!profile.tree) throw new RunError('The profile has no tree settings')
  const tool = options.tool ?? 'iqtree3'
  const version = await ctx.tools.version(tool)
  if (!version) throw new RunError(`${tool} isn't installed or can't be found`)
  const P = paths(profile.id)
  const id = options.runId ?? (await ctx.store.read(P.latest)).trim()
  const dir = P.run(id)
  const aligned = parseFasta(await ctx.store.read(`${dir}/aligned.fasta`))
  const w = options.window ?? { start: 0, end: aligned[0]?.sequence.length ?? 0 }
  const min = options.minCoverage ?? 0.85
  const usable = aligned.map((e) => ({ id: e.id, aligned: e.sequence.slice(w.start, w.end) })).filter((e) => (e.aligned.match(/[ACGT]/gi) ?? []).length >= min * (w.end - w.start))
  const haps = collapseHaplotypes(usable)
  const outgroups = profile.selection.outgroups.map((o) => o.accession).filter((a): a is string => Boolean(a))
  const names = new Map(haps.map((h, i) => [h, `H${String(i + 1).padStart(4, '0')}`]))
  const fasta = writeFasta(haps.map((h) => ({ id: names.get(h)!, sequence: h.representative })))
  const outdir = `${dir}/tree`
  await ctx.store.write(`${outdir}/input.fasta`, fasta)
  const og = haps.filter((h) => h.members.some((m) => outgroups.includes(m))).map((h) => names.get(h)!)
  const t = profile.tree
  const args = ['-s', 'input.fasta', '-m', t.model, '-B', String(t.bootstrap), '--alrt', String(t.shAlrt), '--seed', String(t.seed), '-T', String(t.threads), '-pre', 'tree', '-redo', ...(og.length ? ['-o', og.join(',')] : [])]
  const res = await ctx.tools.run(tool, args, { cwd: `${options.absoluteDir}/${outdir}` })
  if (res.code !== 0) throw new RunError(`${tool} failed: ${res.stderr || res.stdout}`.slice(0, 800))
  const newick = await ctx.store.read(`${outdir}/tree.treefile`)
  const tips = haps.map((h) => ({ id: names.get(h)!, members: h.members }))
  await ctx.store.write(`${outdir}/tips.json`, json(tips))
  return { tool, version, newick, tips, log: res.stdout }
}
