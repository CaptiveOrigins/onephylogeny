import {
  ALIGNER, alignToReference, LOCATE_FLANK, locateMarker, assessAlignment, buildPanel, canonicalJson, checkNumts, collapseHaplotypes, compareRuns, DEFAULT_GATES, extractLocation, findGeneFeatures, fullValidation, gatesForRecord, parseFasta, parseGenBank,
  evaluateQuery, toRecordSheet, toSequenceRecord, validatePanel, verifyBundle, validatedScopeFromReport, validateProfile, validateResult, writeFasta,
  type Alignment, type Curation, type Diagnostic, type GateSettings, type GenBankRecord, type LinkedRecord, type MarkerPlace, type Panel, type PanelBundle, type PanelMember, type Profile, type Result, type Run, type RunComparison, type SequenceRecord, type Snapshot, type ValidationInput,
} from '@captiveorigins/onephylogeny-core'
import { classifyAccessions, genomesHoldingMarkerQuery, linkedAccessions, NcbiClient, selectionQuery, studiesFromRecords, type FoundPaper } from '@captiveorigins/onephylogeny-acquire'
import { hashText, loadArtifact, type Artifact, type ArtifactRef } from './artifacts.js'
import type { EngineContext, Store, ValidationReports } from './context.js'
import { EngineError, isCancelled } from './errors.js'
import { ENGINE, json, profilePaths, withRun, type RunScope } from './run.js'

export * from './errors.js'
export type { EngineContext, Store, ToolRunner, Compute, ValidationReports } from './context.js'
export { traceArtifact, loadArtifact, type ArtifactRef, type ArtifactType, type ArtifactManifest, type TraceNode } from './artifacts.js'
export { ENGINE_VERSION, profilePaths } from './run.js'
export * from './dataset.js'
export * from './route.js'
export * from './curation.js'
import { writeDataset } from './dataset.js'

const cachePath = (version: string) => `cache/genbank/${version.replace(/[^A-Za-z0-9._-]/g, '_')}.gb`

const ref = (a: Artifact): ArtifactRef => ({ type: a.manifest.type, key: a.manifest.key })
const artifactOf = (run: Run, type: ArtifactRef['type']) => run.artifacts.find((a) => a.type === type)

export type RecordOutcome = { record: string; organism?: string; status: 'passed' | 'excluded'; diagnostics: Diagnostic[]; columns: number; identity: number; extractedFrom: 'annotation' | 'located' | 'whole-record' }

export type FetchOutcome = { run: Run; records: SequenceRecord[]; outcomes: RecordOutcome[] }

type Anchored = { record: string; organism?: string; alignment: Alignment | null; extractedFrom: RecordOutcome['extractedFrom']; length: number; ambiguous: number; unverified: boolean; located?: MarkerPlace; manyPlaces?: MarkerPlace[] }

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

const where = (p: MarkerPlace) => `bases ${p.start + 1} to ${p.end} on the ${p.strand === '+' ? 'given' : 'reverse'} strand${p.wrapsOrigin ? ', across the origin' : ''}`

/** A long record with no annotation for the marker has it cut out by similarity, so the usual length and coverage checks apply to the marker. */
function locatedSequence(rec: GenBankRecord, reference: string, profile: Profile, found: { sequence: string; from: RecordOutcome['extractedFrom'] }): { sequence: string; from: RecordOutcome['extractedFrom']; located?: MarkerPlace; manyPlaces?: MarkerPlace[] } {
  const factor = panelGates(profile).containerRecordFactor ?? Infinity
  if (found.from !== 'whole-record' || profile.selection.marker.kind !== 'gene' || found.sequence.length < factor * reference.length) return found
  const location = locateMarker(found.sequence, reference, { ...(rec.circular ? { circular: true } : {}) })
  if (location.status === 'located') return { sequence: location.sequence, from: 'located', located: location.place }
  if (location.status === 'multiple') return { ...found, manyPlaces: location.places }
  return found
}

/** Step: the list of what to fetch. Always asks the source; reuse downstream depends on the answer being the same. */
async function searchStep(scope: RunScope, profile: Profile, client: NcbiClient, options: { allowEmpty?: boolean }) {
  const include = profile.selection.include
  const term = include?.length ? `chosen accessions, ${include.length} records, ${hashText([...include].sort().join('\n'))}` : selectionQuery(profile.selection)
  scope.log('info', 'search', include?.length ? 'Using the accessions chosen in a Study' : 'Searching NCBI', { term })
  const found = include?.length ? include : await client.searchAccessions(term)
  if (!found.length && !options.allowEmpty) throw new EngineError('empty-search', 'NCBI found no records for this taxon and marker', 'Check the taxon, gene names and organelle in Setup')
  const genomes = include?.length ? null : genomesHoldingMarkerQuery(profile.selection)
  if (genomes) {
    // Only a report. Adding them would change what a search means, and a failed lookup shouldn't stop a fetch.
    try {
      const missed = (await client.searchAccessions(genomes)).filter((a) => !found.includes(a))
      if (missed.length) scope.log('warning', 'search', `${missed.length} mitochondrial genomes of these taxa aren't in this search, probably because they don't annotate the marker. They may hold it, and they aren't used unless chosen in a Study, which cuts the marker out by similarity: ${missed.join(', ')}`, { missed })
    } catch (e) {
      if (isCancelled(e)) throw e
      scope.log('warning', 'search', `Couldn't check for mitochondrial genomes the search missed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const extra = [profile.reference!.accession, ...profile.selection.outgroups.map((o) => o.accession).filter((a): a is string => Boolean(a))]
  const accessions = [...new Set([...found, ...extra])].sort()
  scope.log('info', 'search', `Found ${found.length} records, plus ${extra.length} named in the profile`, { found: found.length })
  const artifact = await scope.step({
    type: 'accession-list', step: { name: 'search', version: 1 }, inputs: [], parameters: { term, accessions: hashText(accessions.join('\n')) },
    run: async (put) => { await put('accessions.json', json({ term, accessions })) },
  })
  return { artifact, accessions, term }
}

/** Step: raw files. Each is cached as it arrives, so an interrupted download continues where it stopped. */
function rawStep(scope: RunScope, list: Artifact, accessions: string[], client: NcbiClient, batchSize: number) {
  const { store } = scope.ctx
  return scope.step({
    type: 'raw-records', step: { name: 'fetch', version: 1 }, inputs: [ref(list)], parameters: {},
    run: async (put) => {
      const texts = new Map<string, string>()
      const missing: string[] = []
      for (const version of accessions) {
        const path = cachePath(version)
        if (await store.exists(path)) texts.set(version, await store.read(path))
        else missing.push(version)
      }
      scope.log('info', 'fetch', `${texts.size} records already downloaded, ${missing.length} to fetch`, { done: texts.size, total: accessions.length })
      for (let i = 0; i < missing.length; i += batchSize) {
        scope.checkpoint()
        const batch = missing.slice(i, i + batchSize)
        const { text, records } = await client.fetchGenBankText(batch)
        const blocks = text.split(/^\/\/\s*$/m).filter((b) => b.includes('LOCUS'))
        for (const [n, rec] of records.entries()) {
          const raw = `${blocks[n]!.trimStart()}//\n`
          const key = rec.version || rec.accession
          await store.write(cachePath(key), raw)
          texts.set(key, raw)
        }
        scope.log('info', 'fetch', `Fetched ${Math.min(i + batchSize, missing.length)} of ${missing.length}`, { done: texts.size, total: accessions.length })
      }
      const index = Object.fromEntries([...texts].map(([k, t]) => [k, hashText(t)]).sort(([a], [b]) => String(a).localeCompare(String(b))))
      await put('index.json', json(index))
    },
    ensure: async (read) => (Object.keys(JSON.parse(await read('index.json'))).length ? null : 'no records were fetched'),
  })
}

const markerParameters = (profile: Profile) => ({ marker: profile.selection.marker, reference: profile.reference?.accession })

/** Step: every record in reference coordinates. Pure, and independent of filters, so changing a filter doesn't redo it. */
function anchorStep(scope: RunScope, profile: Profile, raw: Artifact) {
  const { store } = scope.ctx
  return scope.step({
    type: 'anchored-records', step: { name: 'anchor', version: 2 }, inputs: [ref(raw)], parameters: markerParameters(profile), tools: [ALIGNER],
    run: async (put) => {
      const index = JSON.parse(await raw.read('index.json')) as Record<string, string>
      const parsed = new Map<string, GenBankRecord>()
      for (const [version, sha] of Object.entries(index)) {
        const text = await store.read(cachePath(version))
        if (hashText(text) !== sha) throw new EngineError('raw-file-changed', `The downloaded file for ${version} changed after it was fetched`, `Delete ${cachePath(version)} and fetch again`)
        const rec = parseGenBank(text)[0]
        if (!rec) throw new EngineError('raw-file-changed', `The downloaded file for ${version} has no record in it`, `Delete ${cachePath(version)} and fetch again`)
        parsed.set(version, rec)
      }
      const accession = profile.reference!.accession
      const refRec = [...parsed.values()].find((r) => r.version === accession || r.accession === accession)
      if (!refRec) throw new EngineError('reference-missing', `The reference ${accession} wasn't retrieved`, 'Check the reference accession in Setup')
      const reference = geneSequence(refRec, profile).sequence
      scope.log('info', 'anchor', `Reference ${refRec.version}: ${reference.length} columns`)
      const anchored: Anchored[] = []
      const records: SequenceRecord[] = []
      let done = 0
      for (const [version, rec] of parsed) {
        await scope.breathe()
        const { sequence, from, located, manyPlaces } = locatedSequence(rec, reference, profile, geneSequence(rec, profile))
        anchored.push({
          ...(located ? { located } : {}), ...(manyPlaces ? { manyPlaces } : {}),
          record: rec.version || version, ...(rec.organism ? { organism: rec.organism } : {}), alignment: alignToReference(sequence, reference), extractedFrom: from, length: sequence.length,
          ambiguous: (sequence.match(/[^ACGTacgt]/g) ?? []).length, unverified: rec.definition.startsWith('UNVERIFIED'),
        })
        records.push(toSequenceRecord(rec))
        if (++done % 100 === 0) scope.log('debug', 'anchor', `Anchored ${done} of ${parsed.size}`, { done, total: parsed.size })
      }
      await put('reference.fasta', writeFasta([{ id: refRec.version, sequence: reference }]))
      await put('anchored.json', JSON.stringify(anchored))
      await put('records.json', JSON.stringify(records))
    },
    ensure: async (read) => (parseFasta(await read('reference.fasta'))[0]?.sequence.length ? null : 'the reference has no sequence'),
  })
}

/** The checks for records that may enter a panel, where a frame problem excludes rather than warns. */
const panelGates = (profile: Profile): GateSettings => ({ ...DEFAULT_GATES, ...profile.gates, frameErrors: true, ...(profile.reference?.codonStart !== undefined ? { codonStart: profile.reference.codonStart } : {}), ...(profile.reference?.geneticCode ? { geneticCode: profile.reference.geneticCode } : {}) })

/** Step: which records pass, and why the others don't. Every record gets an outcome. */
function gateStep(scope: RunScope, profile: Profile, anchoredArtifact: Artifact) {
  const { filters, exclude } = profile.selection
  const gates = panelGates(profile)
  return scope.step({
    type: 'gated-records', step: { name: 'gate', version: 2 }, inputs: [ref(anchoredArtifact)], parameters: { filters, exclude, gates },
    run: async (put) => {
      const excluded = new Map(exclude.map((e) => [e.accession, e.reason]))
      const anchored = JSON.parse(await anchoredArtifact.read('anchored.json')) as Anchored[]
      const records = JSON.parse(await anchoredArtifact.read('records.json')) as SequenceRecord[]
      const outcomes: RecordOutcome[] = []
      const aligned: { id: string; sequence: string }[] = []
      for (const a of anchored) {
        const assessed = assessAlignment(a.alignment, gatesForRecord(gates, { wholeRecord: a.extractedFrom === 'whole-record', length: a.length, referenceLength: a.alignment?.aligned.length ?? 0 }))
        // The flank kept when cutting a marker out always clips. Clipping beyond it is still reported.
        const onlyFlank = a.located && a.alignment && a.alignment.clipped.start <= LOCATE_FLANK && a.alignment.clipped.end <= LOCATE_FLANK
        const diagnostics = onlyFlank ? assessed.filter((d) => d.code !== 'clipped-ends') : assessed
        const fail = (code: string, message: string) => diagnostics.push({ severity: 'error', code, message })
        const reason = excluded.get(a.record) ?? excluded.get(a.record.split('.')[0]!)
        if (reason) fail('excluded-by-profile', reason)
        if (filters.minLength !== undefined && a.length < filters.minLength) fail('too-short', `${a.length} bp is under the minimum of ${filters.minLength}`)
        if (filters.maxLength !== undefined && a.length > filters.maxLength) fail('too-long', `${a.length} bp is over the maximum of ${filters.maxLength}`)
        if (filters.maxAmbiguous !== undefined && a.ambiguous > filters.maxAmbiguous) fail('too-ambiguous', `${a.ambiguous} ambiguous bases is over the maximum of ${filters.maxAmbiguous}`)
        if (a.unverified) fail('unverified', 'NCBI marks this record UNVERIFIED')
        if (a.located) diagnostics.push({ severity: 'info', code: 'located-by-similarity', message: `The record doesn't annotate this marker, so it was cut out by similarity: ${where(a.located)}. ${a.located.seedHits} shared seeds` })
        if (a.manyPlaces) fail('marker-in-several-places', `The marker looks present in ${a.manyPlaces.length} places, so none was chosen: ${a.manyPlaces.map(where).join('; ')}`)
        const passed = !diagnostics.some((d) => d.severity === 'error')
        outcomes.push({ record: a.record, ...(a.organism ? { organism: a.organism } : {}), status: passed ? 'passed' : 'excluded', diagnostics, columns: a.alignment ? a.alignment.matches + a.alignment.mismatches : 0, identity: a.alignment?.identity ?? 0, extractedFrom: a.extractedFrom })
        if (a.alignment && passed) aligned.push({ id: a.record, sequence: a.alignment.aligned })
      }
      const passing = outcomes.filter((o) => o.status === 'passed').length
      scope.log('info', 'gate', `${passing} records passed, ${outcomes.length - passing} excluded`)
      const counts = new Map<string, number>()
      for (const o of outcomes) for (const d of o.diagnostics) counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
      for (const [code, n] of counts) scope.log('info', 'gate', `${code}: ${n}`)
      await put('outcomes.json', json(outcomes))
      await put('aligned.fasta', writeFasta(aligned))
      await put('reference.fasta', await anchoredArtifact.read('reference.fasta'))
      await put('records.csv', toRecordSheet(records, { checks: outcomes.map((o) => ({ record: o.record, status: o.status, reasons: o.diagnostics.map((d) => d.message) })) }))
    },
  })
}

/**
 * Fetches everything a profile selects, keeps raw files, anchors and checks each record, and writes the sheet and log.
 * Each stage reuses earlier work when its inputs and settings are unchanged.
 */
export async function fetchAndAnchor(ctx: EngineContext, profile: Profile, options: { batchSize?: number; allowEmpty?: boolean } = {}): Promise<FetchOutcome> {
  const errors = validateProfile(profile).filter((d) => d.severity === 'error')
  if (errors.length) throw new EngineError('invalid-profile', `The profile can't run: ${errors.map((e) => e.message).join('; ')}`, 'Fix it in Setup')
  if (!profile.reference?.accession) throw new EngineError('invalid-profile', 'The profile needs a reference accession to anchor records to', 'Add one in Setup')
  const P = profilePaths(profile.id)
  const { value, run } = await withRun(ctx, profile, 'fetch', async (scope) => {
    scope.run.tools.push(ALIGNER)
    const client = new NcbiClient({ ...ctx.ncbi, log: (level, message, data) => scope.log(level, 'ncbi', message, data) })
    const { artifact: list, accessions, term } = await searchStep(scope, profile, client, options)
    const raw = await rawStep(scope, list, accessions, client, options.batchSize ?? 100)
    const anchored = await anchorStep(scope, profile, raw)
    const gated = await gateStep(scope, profile, anchored)
    const records = JSON.parse(await anchored.read('records.json')) as SequenceRecord[]
    const outcomes = JSON.parse(await gated.read('outcomes.json')) as RecordOutcome[]
    const index = JSON.parse(await raw.read('index.json')) as Record<string, string>
    const snapshot: Snapshot = {
      schemaVersion: 1, id: scope.run.id, createdAt: scope.run.startedAt, sources: [{ name: 'NCBI nuccore', query: term, retrievedAt: scope.run.startedAt }], records,
      rawFiles: records.map((r) => ({ path: cachePath(r.version || r.accession), sha256: index[r.version || r.accession] ?? '' })),
    }
    snapshot.checksum = hashText(canonicalJson(snapshot))
    scope.run.snapshot = { id: scope.run.id, checksum: snapshot.checksum }
    const publish = async (name: string, text: string) => {
      await ctx.store.write(`${scope.dir}/${name}`, text)
      scope.run.outputs.push({ path: name, sha256: hashText(text) })
    }
    await publish('snapshot.json', json(snapshot))
    for (const name of ['records.csv', 'outcomes.json', 'aligned.fasta', 'reference.fasta']) await publish(name, await gated.read(name))
    return { records, outcomes }
  })
  // A failed run stays on record, but it never replaces the last good one.
  await ctx.store.write(P.latest, run.id)
  return { run, records: value.records, outcomes: value.outcomes }
}

/** Reference columns a record covers, half open, or nothing if it doesn't align. Uses coordinates only and shows no group results. */
function spanOf(alignment: Alignment | null): [number, number] | undefined {
  if (!alignment) return undefined
  const start = alignment.aligned.search(/[^-]/)
  if (start < 0) return undefined
  return [start, alignment.aligned.length - (alignment.aligned.match(/-*$/)?.[0].length ?? 0)]
}

/** Reads records from the download cache, and fetches the rest without adding to it, since a run's raw files must stay as that run saw them. */
async function studyRecords(ctx: EngineContext, client: NcbiClient, accessions: string[], onProgress?: (done: number, total: number) => void): Promise<GenBankRecord[]> {
  const stop = () => { if (ctx.signal?.aborted) throw new EngineError('cancelled', 'Cancelled') }
  const out: GenBankRecord[] = []
  const missing: string[] = []
  for (const a of accessions) {
    stop()
    if (await ctx.store.exists(cachePath(a))) { const r = parseGenBank(await ctx.store.read(cachePath(a)))[0]; if (r) { out.push(r); continue } }
    missing.push(a)
  }
  for (let i = 0; i < missing.length; i += 100) {
    stop()
    out.push(...(await client.fetchGenBankText(missing.slice(i, i + 100))).records)
    onProgress?.(out.length, accessions.length)
  }
  return out
}

/** The reference's marker sequence, which is what records are placed against. */
async function studyReference(ctx: EngineContext, client: NcbiClient, profile: Profile): Promise<string> {
  const accession = profile.reference?.accession
  if (!accession) throw new EngineError('invalid-profile', 'A Study places records on the reference, and this profile has none', 'Add a reference accession in Setup')
  const [rec] = await studyRecords(ctx, client, [accession])
  if (!rec) throw new EngineError('reference-missing', `The reference ${accession} wasn't retrieved`, 'Check the reference accession in Setup')
  return geneSequence(rec, profile).sequence
}

const countryOf = (rec: GenBankRecord): string | undefined => toSequenceRecord(rec).geoLocName?.split(':')[0]?.trim() || undefined

async function placeRecords(ctx: EngineContext, profile: Profile, records: GenBankRecord[], reference: string, classified: { inTarget: Set<string>; hasMarker: Set<string> }) {
  const placed = new Map<string, LinkedRecord>()
  for (const rec of records) {
    if (ctx.signal?.aborted) throw new EngineError('cancelled', 'Cancelled')
    // Aligning is synchronous, so this keeps the window responsive through a few hundred records.
    await new Promise((r) => setTimeout(r, 0))
    const hasMarker = classified.hasMarker.has(rec.version)
    const span = hasMarker ? spanOf(alignToReference(geneSequence(rec, profile).sequence, reference)) : undefined
    const country = countryOf(rec)
    placed.set(rec.version, { accession: rec.version, organism: rec.organism, length: rec.sequence.length, title: rec.definition, inTarget: classified.inTarget.has(rec.version), hasMarker, ...(country ? { country } : {}), ...(span ? { span } : {}) })
  }
  return placed
}

/** Studies built from GenBank records of a profile's species and marker, placed on the reference. */
export async function findRecordStudies(ctx: EngineContext, profile: Profile, onProgress?: (done: number, total: number) => void): Promise<{ papers: FoundPaper[]; columns: number; query: string }> {
  const client = new NcbiClient(ctx.ncbi)
  const query = selectionQuery(profile.selection)
  const genomes = genomesHoldingMarkerQuery(profile.selection)
  const accessions = [...new Set([...await client.searchAccessions(query), ...(genomes ? await client.searchAccessions(genomes) : [])])]
  const reference = await studyReference(ctx, client, profile)
  const records = await studyRecords(ctx, client, accessions, onProgress)
  const all = new Set(records.map((r) => r.version))
  const placed = await placeRecords(ctx, profile, records, reference, { inTarget: all, hasMarker: all })
  return { papers: studiesFromRecords(records, (r) => placed.get(r.version)!), columns: reference.length, query }
}

/** Looks up what PubMed links to one paper, then sorts those records by species and gene and places them. */
export async function findPaperRecords(ctx: EngineContext, profile: Profile, pmid: string): Promise<{ linked: LinkedRecord[]; columns: number }> {
  const client = new NcbiClient(ctx.ncbi)
  const accessions = await linkedAccessions(client, pmid)
  const reference = await studyReference(ctx, client, profile)
  if (!accessions.length) return { linked: [], columns: reference.length }
  const classified = await classifyAccessions(client, accessions, profile.selection)
  const records = await studyRecords(ctx, client, accessions)
  return { linked: [...(await placeRecords(ctx, profile, records, reference, classified)).values()], columns: reference.length }
}

export type PanelBuildOutcome = { bundle: PanelBundle; diagnostics: Diagnostic[]; validation: ValidationReports; unassigned: number; run: Run; published: boolean }

const defaultValidate = async (input: ValidationInput): Promise<ValidationReports> => fullValidation(input)

/** The records of a finished fetch run (the latest when no ID is given), as the panel build reads them. */
export async function loadRunRecords(store: Store, profileId: string, runId?: string): Promise<SequenceRecord[]> {
  const P = profilePaths(profileId)
  const id = runId ?? ((await store.exists(P.latest)) ? (await store.read(P.latest)).trim() : '')
  if (!id) throw new EngineError('run-missing', 'No finished fetch run exists yet', 'Fetch records first')
  const run = JSON.parse(await store.read(`${P.run(id)}/run.json`)) as Run
  const gatedRef = artifactOf(run, 'gated-records')
  if (!gatedRef) throw new EngineError('run-missing', `Run ${id} didn't finish fetching`, 'Fetch records again')
  const gated = await loadArtifact(store, { type: 'gated-records', key: gatedRef.key })
  return JSON.parse(await (await loadArtifact(store, gated.manifest.inputs[0]!)).read('records.json')) as SequenceRecord[]
}

/** Builds and validates a candidate panel from a finished fetch run and the curation file. */
export async function buildPanelFromRun(ctx: EngineContext, profile: Profile, curation: Curation, id?: string): Promise<PanelBuildOutcome> {
  const settings = profile.panel
  if (!settings) throw new EngineError('invalid-profile', 'The profile has no panel settings', 'Add groups in the Panel tab')
  if (!settings.rules) throw new EngineError('invalid-profile', 'This profile predates evaluation rules, so a panel built from it would use values nobody chose', 'Set the rules in the Panel tab and give the panel a new version')
  const P = profilePaths(profile.id)
  const sourceId = id ?? (await ctx.store.exists(P.latest) ? (await ctx.store.read(P.latest)).trim() : '')
  if (!sourceId) throw new EngineError('run-missing', 'No finished fetch run exists yet', 'Fetch records first')
  const source = JSON.parse(await ctx.store.read(`${P.run(sourceId)}/run.json`)) as Run
  const gatedRef = artifactOf(source, 'gated-records')
  if (!gatedRef) throw new EngineError('run-missing', `Run ${sourceId} didn't finish fetching`, 'Fetch records again')
  const { value, run } = await withRun(ctx, profile, 'panel', async (scope) => {
    scope.run.tools.push(ALIGNER)
    const gated = await loadArtifact(ctx.store, { type: 'gated-records', key: gatedRef.key })
    const aligned = parseFasta(await gated.read('aligned.fasta'))
    const reference = parseFasta(await gated.read('reference.fasta'))[0]!
    const groupIds = new Set(settings.groups.map((g) => g.id))
    const records = JSON.parse(await (await loadArtifact(ctx.store, gated.manifest.inputs[0]!)).read('records.json')) as SequenceRecord[]
    const studyOf = new Map(records.map((r) => [r.version, r.publications.find((p) => p.title && p.title !== 'Direct Submission')?.title]))
    const members: PanelMember[] = []
    const diagnostics: Diagnostic[] = []
    let unassigned = 0
    for (const e of aligned) {
      const decision = curation.records[e.id]
      if (decision?.exclude) continue
      if (!decision?.group) { unassigned++; continue }
      if (!groupIds.has(decision.group)) { diagnostics.push({ severity: 'error', code: 'unknown-group', message: `${e.id} names group ${decision.group}, which isn't in the panel settings`, ids: [e.id] }); continue }
      const study = decision.study ?? studyOf.get(e.id)
      members.push({ record: e.id, group: decision.group, aligned: e.sequence, provenanceClass: decision.provenanceClass ?? 'unknown', ...(decision.use ? { use: decision.use } : {}), ...(decision.site ? { block: decision.site } : {}), ...(decision.originSource ? { originSource: decision.originSource } : {}), ...(study ? { study } : {}) })
    }
    if (!members.length && !diagnostics.some((d) => d.severity === 'error')) throw new EngineError('empty-panel', 'No records are assigned to a group, so there is nothing to build', 'Assign records to groups in the Records tab')
    const memberIds = new Set(members.map((m) => m.record))
    const citations = new Map<string, { citation: string }>()
    for (const r of records) if (memberIds.has(r.version)) for (const p of r.publications) if (p.title) citations.set(p.title, { citation: [p.authors, p.title, p.journal].filter(Boolean).join('. ') })
    // A screen's library, if one was saved for this profile. The screen runs outside the app, once per species.
    const numtPath = `profiles/${profile.id}/numt-screen/numt-library.fasta`
    const numtCopies = (await ctx.store.exists(numtPath)) ? parseFasta(await ctx.store.read(numtPath)).map((e) => ({ id: e.id, aligned: e.sequence })) : []
    const input = {
      settings, taxa: profile.selection.taxa, marker: profile.selection.marker,
      reference: { accession: reference.id, length: reference.sequence.length, ...(profile.reference?.codonStart !== undefined ? { codonStart: profile.reference.codonStart } : {}), ...(profile.reference?.geneticCode ? { geneticCode: profile.reference.geneticCode } : {}) },
      sources: [...citations.values()], builtBy: gated.manifest.key, referenceSequence: reference.sequence, builtWith: [ENGINE, ALIGNER],
      // The checks that actually ran on these records, even if the profile has changed since.
      gates: (gated.manifest.parameters as { gates: GateSettings }).gates,
      ...(numtCopies.length ? { numtCopies } : {}),
      // From the fetch these records came from, not today's profile, which may have moved to another Study.
      ...(source.profile.selection.fromStudy ? { study: source.profile.selection.fromStudy } : {}),
    }
    if (settings.validatedScope.length) diagnostics.push({ severity: 'warning', code: 'hand-entered-scope-ignored', message: 'The scope written in the panel settings is ignored. A panel\'s scope now comes only from claims that pass validation', path: 'panel.validatedScope' })
    const draft = buildPanel({ ...input, members })
    diagnostics.push(...validatePanel(draft.panel).filter((d) => d.code !== 'not-validated'))
    const empty = { scheme: 'leave-one-block-out' as const, tested: 0, skipped: 0, groups: [], untestedGroups: [], diagnostics: [] }
    const hasErrors = diagnostics.some((d) => d.severity === 'error')
    if (hasErrors) return { bundle: draft, diagnostics, validation: { blocks: empty, groups: { ...empty, scheme: 'leave-one-group-out' as const }, ladder: [], claims: [], controls: { shuffles: 0, simulations: 0, seed: 0 } }, unassigned, published: false }
    // Validation comes first, because a panel's scope is whatever passes it. The folds ignore scope, so nothing is circular.
    const fingerprint = hashText(canonicalJson({ settings: { ...settings, version: '', id: '' }, members: members.map(({ aligned, ...m }) => ({ ...m, aligned: hashText(aligned) })) }))
    const validationArtifact = await scope.step({
      type: 'validation', step: { name: 'validate', version: 3 }, inputs: [ref(gated)], parameters: { fingerprint },
      run: async (put) => {
        const reports = await (ctx.compute?.validate ?? defaultValidate)({ ...input, members }, ctx.signal)
        await put('validation.json', json(reports))
      },
    })
    const validation = JSON.parse(await validationArtifact.read('validation.json')) as ValidationReports
    const bundle = buildPanel({ ...input, members, claims: validatedScopeFromReport(validation.claims) })
    if (!bundle.panel.claims.length) diagnostics.push({ severity: 'warning', code: 'not-validated', message: 'No claim passed validation, so this panel has no validated scope', path: 'validatedScope' })
    const out = P.panel(bundle.panel.id, bundle.panel.version)
    if (await ctx.store.exists(`${out}/panel.json`)) {
      const existing = JSON.parse(await ctx.store.read(`${out}/panel.json`)) as Panel
      if (existing.checksum !== bundle.panel.checksum) throw new EngineError('panel-version-exists', `Panel ${bundle.panel.id} version ${bundle.panel.version} already exists with different content`, 'Give this build a new version, so earlier results stay true')
    }
    const panelArtifact = await scope.step({
      type: 'panel', step: { name: 'panel', version: 2 }, inputs: [ref(gated), ref(validationArtifact)], parameters: { checksum: bundle.panel.checksum }, tools: [ENGINE, ALIGNER],
      run: async (put) => {
        await put('panel.json', json(bundle.panel))
        await put('panel.fasta', writeFasta([{ id: '__reference__', sequence: reference.sequence }, ...Object.entries(bundle.sequences).map(([k, sequence]) => ({ id: k, sequence }))]))
      },
    })
    await ctx.store.write(`${out}/panel.json`, await panelArtifact.read('panel.json'))
    await ctx.store.write(`${out}/panel.fasta`, await panelArtifact.read('panel.fasta'))
    await ctx.store.write(`${out}/validation.json`, json(validation))
    await ctx.store.write(`${out}/diagnostics.json`, json({ diagnostics, unassigned }))
    await ctx.store.write(`${out}/artifact.json`, json(ref(panelArtifact)))
    // Examples with the answers they give now, and every file's hash, so any copy can be verified (roadmap stage 2).
    await writeDataset(ctx.store, out, bundle, testSample)
    return { bundle, diagnostics, validation, unassigned, published: true }
  })
  return { ...value, run }
}

export async function loadPanel(store: Store, dir: string): Promise<PanelBundle> {
  if (!(await store.exists(`${dir}/panel.json`))) throw new EngineError('panel-missing', 'This panel hasn\'t been built yet', 'Build it in the Panel tab')
  const panel = JSON.parse(await store.read(`${dir}/panel.json`)) as Panel
  if (panel.schemaVersion !== 2) throw new EngineError('panel-outdated', `Panel ${panel.id} version ${panel.version} was built with an earlier format, so it can't be read by the current evaluator`, 'Build it again under a new version')
  const fasta = parseFasta(await store.read(`${dir}/panel.fasta`))
  const referenceSequence = fasta.find((f) => f.id === '__reference__')?.sequence
  const bundle: PanelBundle = { panel, sequences: Object.fromEntries(fasta.filter((f) => f.id !== '__reference__').map((f) => [f.id, f.sequence])), ...(referenceSequence ? { referenceSequence } : {}) }
  const problems = verifyBundle(bundle)
  if (problems.length) throw new EngineError('panel-changed', `Panel ${panel.id} version ${panel.version} doesn't match its seal: ${problems.map((p) => p.message).join('; ')}`, 'Restore it from its source, or build it again under a new version')
  return bundle
}

/** The versions built for a profile's panel, oldest first. Every one is listed, so no attempt can be left out. */
export function panelVersions(profile: Profile, folders: string[]): string[] {
  const prefix = `${profile.panel?.id ?? ''}-`
  const parts = (v: string) => v.split('.').map(Number)
  const order = (a: string, b: string) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d } return a.localeCompare(b) }
  return folders.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length)).sort(order)
}

/** Compares two built versions. Both must still match their seals. */
export async function comparePanelVersions(store: Store, profile: Profile, a: string, b: string): Promise<RunComparison> {
  if (!profile.panel) throw new EngineError('invalid-profile', 'The profile has no panel settings', 'Add groups in the Panel tab')
  const P = profilePaths(profile.id)
  const load = async (version: string) => {
    const dir = P.panel(profile.panel!.id, version)
    const { panel } = await loadPanel(store, dir)
    const report = (await store.exists(`${dir}/validation.json`)) ? (JSON.parse(await store.read(`${dir}/validation.json`)) as ValidationReports).claims : undefined
    return { panel, report }
  }
  const [x, y] = [await load(a), await load(b)]
  return compareRuns(x.panel, y.panel, x.report, y.report)
}

export type SampleOutcome = { result: Result; diagnostics: Diagnostic[]; aligned: string; insertions: number; deletions: number; identity: number; clipped: { start: number; end: number } } | { result: null; diagnostics: Diagnostic[] }

/** Tests one sequence against one panel. Pure TypeScript: runs in the app, the CLI or a hosted site. */
export function testSample(sequence: string, queryId: string, bundle: PanelBundle, options: { runId?: string } = {}): SampleOutcome {
  if (!bundle.referenceSequence) throw new EngineError('panel-outdated', 'This panel has no reference sequence', 'Build it again')
  const a = alignToReference(sequence, bundle.referenceSequence)
  // The panel's own checks. A frame problem in a sample warns rather than refuses: it's shown with the result, for a person to weigh.
  const diagnostics = assessAlignment(a, { ...bundle.panel.gates, frameErrors: false })
  if (!a || diagnostics.some((d) => d.severity === 'error')) return { result: null, diagnostics }
  // The check runs before the result so a flag is part of what the result says about itself.
  const numtCaveats: string[] = []
  if (bundle.panel.numtCopies?.length) {
    const numt = checkNumts(a.aligned, bundle.panel.numtCopies, bundle.referenceSequence)
    for (const f of numt.flagged) diagnostics.push({ severity: 'warning', code: 'numt-flagged', message: `This sequence is closer to nuclear copy ${f.copy} than to the reference, over ${f.shared} columns (${(f.toCopy * 100).toFixed(1)}% against ${(f.toReference * 100).toFixed(1)}%). Review it. This doesn't prove it's a nuclear copy` })
    numtCaveats.push(numt.flagged.length ? 'Flagged for review as possibly a nuclear copy of the marker' : `Compared with ${numt.tested} of ${bundle.panel.numtCopies.length} known nuclear copies with no flag. That doesn't clear it, since copies absent from the screened genome can't be seen`)
  }
  const result = evaluateQuery(a.aligned, bundle, {
    queryId, runId: options.runId ?? 'sample', querySha256: hashText(sequence.toUpperCase()), producedBy: [ENGINE, ALIGNER],
    caveats: ['Rules are configured values and these statuses are not probabilities', ...diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message), ...numtCaveats],
  })
  diagnostics.push(...validateResult(result, bundle.panel))
  return { result, diagnostics, aligned: a.aligned, insertions: a.insertions.reduce((s, x) => s + x.length, 0), deletions: a.deletions.reduce((s, x) => s + x.length, 0), identity: a.identity, clipped: a.clipped }
}

/** Tests a sequence with a full record: a saved result that traces back to its panel, the records and raw files. */
export async function runSample(ctx: EngineContext, profile: Profile, sequence: string, queryId: string): Promise<SampleOutcome & { run: Run; artifact: ArtifactRef }> {
  if (!profile.panel) throw new EngineError('invalid-profile', 'The profile has no panel settings', 'Add groups in the Panel tab')
  const P = profilePaths(profile.id)
  const dir = P.panel(profile.panel.id, profile.panel.version)
  const bundle = await loadPanel(ctx.store, dir)
  const panelRef = JSON.parse(await ctx.store.read(`${dir}/artifact.json`)) as ArtifactRef
  const { value, run } = await withRun(ctx, profile, 'sample', async (scope) => {
    scope.run.tools.push(ALIGNER)
    const panelArtifact = await loadArtifact(ctx.store, panelRef)
    // The artifact is what the provenance trace names, so the copy being evaluated must be that same panel.
    if ((JSON.parse(await panelArtifact.read('panel.json')) as Panel).checksum !== bundle.panel.checksum) throw new EngineError('panel-changed', `The saved copy of panel ${bundle.panel.id} isn't the one its record traces back to`, 'Build it again under a new version')
    const artifact = await scope.step({
      type: 'sample-result', step: { name: 'sample', version: 1 }, inputs: [ref(panelArtifact)], parameters: { queryId, sequence: hashText(sequence.toUpperCase()) }, tools: [ENGINE, ALIGNER],
      run: async (put) => { await put('outcome.json', json(testSample(sequence, queryId, bundle, { runId: scope.run.id }))) },
    })
    const text = await artifact.read('outcome.json')
    await ctx.store.write(`${P.results}/${bundle.panel.id}-${bundle.panel.version}/${queryId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`, text)
    return { outcome: JSON.parse(text) as SampleOutcome, artifact: ref(artifact) }
  })
  return { ...value.outcome, run, artifact: value.artifact }
}

export type TreeOutcome = { tool: string; version: string; newick: string; tips: { id: string; members: string[] }[]; run: Run; artifact: ArtifactRef }

/** Builds a tree with IQ-TREE from one coverage window of a run's records. */
export async function buildTree(ctx: EngineContext, profile: Profile, options: { runId?: string; absoluteDir: string; tool?: string; window?: { start: number; end: number }; minCoverage?: number }): Promise<TreeOutcome> {
  if (!ctx.tools) throw new EngineError('tool-missing', 'Building a tree needs a tool runner')
  const settings = profile.tree
  if (!settings) throw new EngineError('invalid-profile', 'The profile has no tree settings')
  const tool = options.tool ?? 'iqtree3'
  const version = await ctx.tools.version(tool)
  if (!version) throw new EngineError('tool-missing', `${tool} isn't installed or can't be found`, `Install it with: brew install ${tool}`)
  const tools = ctx.tools
  const P = profilePaths(profile.id)
  const sourceId = options.runId ?? (await ctx.store.exists(P.latest) ? (await ctx.store.read(P.latest)).trim() : '')
  if (!sourceId) throw new EngineError('run-missing', 'No finished fetch run exists yet', 'Fetch records first')
  const source = JSON.parse(await ctx.store.read(`${P.run(sourceId)}/run.json`)) as Run
  const gatedRef = artifactOf(source, 'gated-records')
  if (!gatedRef) throw new EngineError('run-missing', `Run ${sourceId} didn't finish fetching`, 'Fetch records again')
  const { value, run } = await withRun(ctx, profile, 'tree', async (scope) => {
    scope.run.tools.push({ name: tool, version })
    const gated = await loadArtifact(ctx.store, { type: 'gated-records', key: gatedRef.key })
    const aligned = parseFasta(await gated.read('aligned.fasta'))
    const w = options.window ?? { start: 0, end: aligned[0]?.sequence.length ?? 0 }
    const min = options.minCoverage ?? 0.85
    const usable = aligned.map((e) => ({ id: e.id, aligned: e.sequence.slice(w.start, w.end) })).filter((e) => (e.aligned.match(/[ACGT]/gi) ?? []).length >= min * (w.end - w.start))
    const haps = collapseHaplotypes(usable)
    if (haps.length < 4) throw new EngineError('step-output-invalid', `Only ${haps.length} haplotypes cover this window, and a tree needs at least 4`, 'Choose another window, or lower the coverage needed')
    const outgroups = profile.selection.outgroups.map((o) => o.accession).filter((a): a is string => Boolean(a))
    const names = new Map(haps.map((h, i) => [h, `H${String(i + 1).padStart(4, '0')}`]))
    const og = haps.filter((h) => h.members.some((m) => outgroups.includes(m))).map((h) => names.get(h)!)
    const artifact = await scope.step({
      type: 'tree', step: { name: 'tree', version: 1 }, inputs: [ref(gated)], parameters: { window: w, minCoverage: min, tree: settings, outgroups: og }, tools: [{ name: tool, version }],
      run: async (put, dir, register) => {
        await put('input.fasta', writeFasta(haps.map((h) => ({ id: names.get(h)!, sequence: h.representative }))))
        await put('tips.json', json(haps.map((h) => ({ id: names.get(h)!, members: h.members }))))
        const args = ['-s', 'input.fasta', '-m', settings.model, '-B', String(settings.bootstrap), '--alrt', String(settings.shAlrt), '--seed', String(settings.seed), '-T', String(settings.threads), '-pre', 'tree', '-redo', ...(og.length ? ['-o', og.join(',')] : [])]
        const res = await tools.run(tool, args, { cwd: `${options.absoluteDir}/${dir}` })
        await ctx.store.write(`${dir}/tool.log`, `${res.stdout}\n${res.stderr}`)
        if (res.code !== 0) throw new EngineError('tool-failed', `${tool} failed: ${(res.stderr || res.stdout).slice(0, 600)}`, `See ${dir}/tool.log`)
        await register('tree.treefile')
        await register('tree.iqtree')
      },
      ensure: async (read) => ((await read('tree.treefile')).includes('(') ? null : 'the tree file has no tree in it'),
    })
    return { newick: await artifact.read('tree.treefile'), tips: JSON.parse(await artifact.read('tips.json')) as TreeOutcome['tips'], artifact: ref(artifact) }
  })
  return { tool, version, ...value, run }
}
