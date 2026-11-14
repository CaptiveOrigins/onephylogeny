import {
  canonicalJson, claimText, parseFasta, planTest, runTest,
  type ArtifactPointer, type HypothesisArtifacts, type HypothesisClaim, type HypothesisPanel, type HypothesisResult, type HypothesisVerdict, type Panel, type PanelBundle, type PanelVersion, type Profile, type Result, type Run, type StatedTest,
} from '@extantape/onephylogeny-core'
import { hashText, readManifest, verifyFiles, type ArtifactRef } from './artifacts.js'
import type { EngineContext, Store } from './context.js'
import type { DatasetManifest } from './dataset.js'
import { EngineError } from './errors.js'
import { loadPanel } from './index.js'
import { profilePaths } from './run.js'

/**
 * Hypothesis chat, engine side (roadmap stage 9, ADR 0013). Finds the saved artifacts a claim needs in the store, loads
 * them with the store's own file checks, and hands them to core's `planTest` and `runTest`. `filesVerified` is always
 * worked out here from the recorded hashes, never taken from a caller. Everything here only reads: no run record, log,
 * cache or result is written, and nothing is fetched or built.
 */

/** Where an artifact named in the stated test was found, so running reads exactly that again. */
export type HypothesisSource =
  /** A built panel's folder. `artifact` is the panel artifact its `artifact.json` names, when there is one. */
  | { kind: 'panel'; pointer: ArtifactPointer; folder: string; artifact?: ArtifactRef }
  /** A saved sample result, as `runSample` copies it into `results/`, and the artifact its run recorded. */
  | { kind: 'result'; pointer: ArtifactPointer; file: string; artifact?: ArtifactRef }

/** A stated test, with where each artifact it names was found and what the loading noticed on the way. */
export type HypothesisPlan = {
  stated: StatedTest
  /** The profile whose folders were read, or absent for a lone panel folder. */
  profile?: string
  sources: HypothesisSource[]
  /** Plain words: panels or results that were skipped or couldn't be checked, and why. */
  notes: string[]
}

export type HypothesisOutcome = HypothesisVerdict & { notes: string[] }

/** Lists the sub-folders of a folder. The store's own, when it has one. */
const foldersOf = (store: Store) => store.folders?.bind(store)

const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_')

/** The panel versions a claim names, if any. */
function namedVersions(claim: HypothesisClaim): PanelVersion[] {
  if (claim.kind === 'panel-changed-call') return [claim.from, claim.to]
  return claim.panel ? [claim.panel] : []
}

const claimSample = (claim: HypothesisClaim) => (claim.kind === 'groups-distinct' ? undefined : claim.sample)

type Loaded<T> = { item: T; source: HypothesisSource; notes?: string[] } | { note: string }

/** Reads a panel's files without the seal check, so a panel that fails it can still be named and reported. */
async function readBundle(store: Store, folder: string): Promise<PanelBundle> {
  const panel = JSON.parse(await store.read(`${folder}/panel.json`)) as Panel
  const fasta = parseFasta(await store.read(`${folder}/panel.fasta`))
  const referenceSequence = fasta.find((f) => f.id === '__reference__')?.sequence
  return { panel, sequences: Object.fromEntries(fasta.filter((f) => f.id !== '__reference__').map((f) => [f.id, f.sequence])), ...(referenceSequence ? { referenceSequence } : {}) }
}

const readJson = async <T>(store: Store, path: string): Promise<T | undefined> => {
  if (!(await store.exists(path))) return undefined
  try {
    return JSON.parse(await store.read(path)) as T
  } catch {
    return undefined
  }
}

/**
 * Loads one panel folder with every file check there is for it: its seal (`loadPanel`), its files against the panel
 * artifact its `artifact.json` names, and against `dataset.json`. A lone folder's `artifact.json` points into another
 * machine's store, so there it only names the panel. Re-loading for a run, the folder must still name the artifact it
 * named when the test was stated. `filesVerified` is true only if every check that
 * could run passed, false if any failed, and left out only when the folder has no record to check against at all.
 */
async function loadPanelSource(store: Store, folder: string, label: string, artifactCheck: 'workspace' | 'folder' | ArtifactRef): Promise<Loaded<HypothesisPanel>> {
  let bundle: PanelBundle
  const problems: string[] = []
  try {
    bundle = await loadPanel(store, folder)
  } catch (e) {
    if (!(e instanceof EngineError) || e.code !== 'panel-changed') return { note: `${label} was skipped: ${(e as Error).message}` }
    // A panel that fails its seal is kept, marked as failing, so a test that needs it reports a data problem.
    bundle = await readBundle(store, folder)
    problems.push(e.message)
  }
  let checked = 0
  const artifact = await readJson<ArtifactRef>(store, `${folder}/artifact.json`)
  if (typeof artifactCheck === 'object' && (artifact?.type !== artifactCheck.type || artifact.key !== artifactCheck.key)) problems.push(`it no longer names panel artifact ${artifactCheck.key}`)
  if (artifact && artifactCheck !== 'folder') {
    checked++
    const manifest = await readManifest(store, artifact).catch(() => null)
    if (!manifest) problems.push(`the panel artifact ${artifact.key} it names is missing or damaged`)
    else if (!(await verifyFiles(store, manifest))) problems.push(`the files of panel artifact ${artifact.key} don't match their recorded hashes`)
    else for (const name of ['panel.json', 'panel.fasta']) {
      const recorded = manifest.files.find((f) => f.name === name)?.sha256
      if (!recorded || hashText(await store.read(`${folder}/${name}`)) !== recorded) problems.push(`${name} isn't the file panel artifact ${artifact.key} recorded`)
    }
  }
  const dataset = await readJson<DatasetManifest>(store, `${folder}/dataset.json`)
  if (dataset) {
    checked++
    for (const [name, hash] of Object.entries(dataset.files)) {
      if (!(await store.exists(`${folder}/${name}`))) problems.push(`${name} is listed in dataset.json but missing`)
      else if (hashText(await store.read(`${folder}/${name}`)) !== hash) problems.push(`${name} has changed since dataset.json was written`)
    }
  }
  const pointer: ArtifactPointer = artifact ? { type: artifact.type, key: artifact.key } : { type: 'panel-dataset', key: bundle.panel.checksum ?? hashText(canonicalJson(bundle.panel)) }
  const filesVerified = problems.length ? false : checked ? true : undefined
  const notes = problems.length ? [`${label} failed its file checks: ${problems.join('; ')}`] : checked ? [] : [`${label} has no artifact.json or dataset.json, so its files couldn't be checked against recorded hashes`]
  const item: HypothesisPanel = { artifact: pointer, bundle, ...(filesVerified !== undefined ? { filesVerified } : {}) }
  return { item, source: { kind: 'panel', pointer, folder, ...(artifact && artifactCheck !== 'folder' ? { artifact } : {}) }, ...(notes.length ? { notes } : {}) }
}

type SavedOutcome = { result: Result | null; aligned?: string; diagnostics?: { severity: string; message: string }[] }

/**
 * Loads one saved result. It is traced through the run that made it (`result.run`) to the `sample-result` artifact that
 * run recorded, whose files must match their hashes and whose `outcome.json` must be this copy, byte for byte.
 */
async function loadResultSource(store: Store, profileId: string, file: string, label: string): Promise<Loaded<HypothesisResult>> {
  let text: string
  let saved: SavedOutcome
  try {
    text = await store.read(file)
    saved = JSON.parse(text) as SavedOutcome
  } catch {
    return { note: `${label} couldn't be read as a saved result, so it was skipped` }
  }
  if (!saved.result) {
    const why = (saved.diagnostics ?? []).filter((d) => d.severity === 'error').map((d) => d.message).join('; ')
    return { note: `${label} has no result: the sample was refused${why ? ` (${why})` : ''}` }
  }
  const result = saved.result
  const P = profilePaths(profileId)
  const problems: string[] = []
  let artifact: ArtifactRef | undefined
  const run = await readJson<Run>(store, `${P.run(result.run)}/run.json`)
  if (!run) problems.push(`the run that made it, ${result.run}, has no record`)
  else {
    for (const a of run.artifacts.filter((x) => x.type === 'sample-result')) {
      const ref: ArtifactRef = { type: 'sample-result', key: a.key }
      const manifest = await readManifest(store, ref).catch(() => null)
      if (!manifest || (manifest.parameters as { queryId?: string }).queryId !== result.query) continue
      artifact = ref
      if (!(await verifyFiles(store, manifest))) problems.push(`the files of sample-result ${a.key} don't match their recorded hashes`)
      else if (manifest.files.find((f) => f.name === 'outcome.json')?.sha256 !== hashText(text)) problems.push(`this copy isn't the outcome sample-result ${a.key} recorded`)
      break
    }
    if (!artifact) problems.push(`run ${result.run} recorded no saved result for ${result.query}`)
  }
  const pointer: ArtifactPointer = artifact ? { type: artifact.type, key: artifact.key } : { type: 'sample-result-copy', key: file }
  const item: HypothesisResult = { artifact: pointer, result, ...(saved.aligned ? { aligned: saved.aligned } : {}), filesVerified: problems.length === 0 }
  const source: HypothesisSource = { kind: 'result', pointer, file, ...(artifact ? { artifact } : {}) }
  return { item, source, ...(problems.length ? { notes: [`${label} failed its file checks: ${problems.join('; ')}`] } : {})}
}

type Gathered = { artifacts: { panels: HypothesisPanel[]; results: HypothesisResult[] }; sources: HypothesisSource[]; notes: string[] }

function collect<T>(into: Gathered, loaded: Loaded<T>, push: (item: T) => void) {
  if ('note' in loaded) return void into.notes.push(loaded.note)
  push(loaded.item)
  into.sources.push(loaded.source)
  into.notes.push(...(loaded.notes ?? []))
}

/** Every panel version and every saved result for the claim's sample that the profile's folders hold. */
async function gather(ctx: EngineContext, profile: Profile, claim: HypothesisClaim): Promise<Gathered | { untestable: string; notes: string[] }> {
  const { store } = ctx
  const P = profilePaths(profile.id)
  const panelsRoot = `profiles/${profile.id}/panels`
  const list = foldersOf(store)
  const named = namedVersions(claim)
  let panelFolders: string[]
  let resultFolders: string[]
  if (list) {
    panelFolders = (await list(panelsRoot)).map((f) => `${panelsRoot}/${f}`)
    resultFolders = (await list(P.results)).map((f) => `${P.results}/${f}`)
  } else {
    // Without a way to list folders, only versions the claim names can be found, and none is ever guessed.
    if (!named.length) return { untestable: "this store can't list the panel versions it holds, so the claim has to name one", notes: [] }
    panelFolders = named.map((v) => P.panel(v.id, v.version))
    resultFolders = named.map((v) => `${P.results}/${v.id}-${v.version}`)
  }
  const out: Gathered = { artifacts: { panels: [], results: [] }, sources: [], notes: [] }
  for (const folder of panelFolders) {
    if (!(await store.exists(`${folder}/panel.json`))) continue
    collect(out, await loadPanelSource(store, folder, `The panel in ${folder}`, 'workspace'), (p) => out.artifacts.panels.push(p))
  }
  const sample = claimSample(claim)
  if (sample) for (const folder of resultFolders) {
    const file = `${folder}/${safeName(sample)}.json`
    if (!(await store.exists(file))) continue
    collect(out, await loadResultSource(store, profile.id, file, `The saved result ${file}`), (r) => out.artifacts.results.push(r))
  }
  return out
}

/** Where each artifact the stated test reads was found, in the order the test names them. */
const sourcesFor = (stated: StatedTest, sources: HypothesisSource[]): HypothesisSource[] =>
  stated.uses.flatMap((u) => sources.filter((s) => s.pointer.type === u.artifact.type && s.pointer.key === u.artifact.key).slice(0, 1))

const notTestable = (claim: HypothesisClaim, reason: string): StatedTest => ({
  claim, claimText: claimText(claim), testable: false, reason, uses: [], text: `This can't be tested with the artifacts given: ${reason}.`,
})

/**
 * States the test for a claim against a profile's saved panels and results, before anything runs. Finds every panel
 * version and every saved result for the claim's sample, loads each with its file and seal checks, and asks core's
 * `planTest` which of them the test will read. Writes nothing.
 */
export async function testHypothesis(ctx: EngineContext, profile: Profile, claim: HypothesisClaim): Promise<HypothesisPlan> {
  const g = await gather(ctx, profile, claim)
  if ('untestable' in g) return { stated: notTestable(claim, g.untestable), profile: profile.id, sources: [], notes: g.notes }
  const stated = planTest(claim, g.artifacts)
  return { stated, profile: profile.id, sources: sourcesFor(stated, g.sources), notes: g.notes }
}

/**
 * The same for a single panel folder outside any workspace, such as a downloaded dataset (`--dir`). Its files are
 * checked against its `dataset.json`. A folder holds no saved results, so only `groups-distinct` can be tested here.
 */
export async function testHypothesisOnPanel(ctx: EngineContext, folder: string, claim: HypothesisClaim): Promise<HypothesisPlan> {
  const out: Gathered = { artifacts: { panels: [], results: [] }, sources: [], notes: [] }
  collect(out, await loadPanelSource(ctx.store, folder, 'The panel folder', 'folder'), (p) => out.artifacts.panels.push(p))
  if (claimSample(claim)) out.notes.push('A panel folder holds no saved results; give a workspace and profile to test claims about a sample')
  const stated = planTest(claim, out.artifacts)
  return { stated, sources: sourcesFor(stated, out.sources), notes: out.notes }
}

/**
 * Runs a stated test. Re-loads exactly the artifacts it names, from where they were found, with the same file and seal
 * checks, then runs core's `runTest`, which refuses anything that changed since the test was stated. A plan that wasn't
 * testable comes back `untestable with this data` without reading anything. Writes nothing.
 */
export async function runHypothesis(ctx: EngineContext, plan: HypothesisPlan): Promise<HypothesisOutcome> {
  // Nothing is read again for a plan that wasn't testable, so there is nothing new to note.
  if (!plan.stated.testable) return { ...runTest(plan.stated, { panels: [], results: [] }), notes: [] }
  const out: Gathered = { artifacts: { panels: [], results: [] }, sources: [], notes: [] }
  for (const s of plan.sources) {
    if (s.kind === 'panel') {
      if (!(await ctx.store.exists(`${s.folder}/panel.json`))) { out.notes.push(`The panel in ${s.folder} is gone`); continue }
      collect(out, await loadPanelSource(ctx.store, s.folder, `The panel in ${s.folder}`, s.artifact ?? (plan.profile ? 'workspace' : 'folder')), (p) => out.artifacts.panels.push(p))
    } else {
      if (!(await ctx.store.exists(s.file))) { out.notes.push(`The saved result ${s.file} is gone`); continue }
      collect(out, await loadResultSource(ctx.store, plan.profile ?? '', s.file, `The saved result ${s.file}`), (r) => out.artifacts.results.push(r))
    }
  }
  const verdict = runTest(plan.stated, out.artifacts as HypothesisArtifacts)
  return { ...verdict, notes: out.notes }
}
