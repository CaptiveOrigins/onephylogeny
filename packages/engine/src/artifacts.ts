import { canonicalJson, sha256Hex } from '@captiveorigins/onephylogeny-core'
import { EngineError } from './errors.js'
import type { Store } from './context.js'

export type ArtifactType = 'accession-list' | 'raw-records' | 'anchored-records' | 'gated-records' | 'panel' | 'validation' | 'sample-result' | 'tree'

export type ToolIdentity = { name: string; version: string }

export type ArtifactRef = { type: ArtifactType; key: string }

/** Written last. Its presence is what says a step finished, so a crash can't leave something that looks complete. */
export type ArtifactManifest = {
  schemaVersion: 1
  type: ArtifactType
  key: string
  step: { name: string; version: number }
  inputs: ArtifactRef[]
  parameters: unknown
  tools: ToolIdentity[]
  files: { name: string; sha256: string }[]
  createdAt: string
}

export const hashText = (text: string) => `sha256:${sha256Hex(text)}`
export const artifactDir = ({ type, key }: ArtifactRef) => `artifacts/${type}/${key.replace('sha256:', '')}`

export function stepKey(spec: { type: ArtifactType; step: { name: string; version: number }; inputs: ArtifactRef[]; parameters: unknown; tools: ToolIdentity[] }): string {
  return hashText(canonicalJson({ type: spec.type, step: spec.step, inputs: spec.inputs, parameters: spec.parameters, tools: spec.tools }))
}

/** Reads a manifest and checks its type. Returns null only if the artifact was never finished. */
export async function readManifest(store: Store, ref: ArtifactRef): Promise<ArtifactManifest | null> {
  const path = `${artifactDir(ref)}/manifest.json`
  if (!(await store.exists(path))) return null
  let manifest: ArtifactManifest
  try {
    manifest = JSON.parse(await store.read(path))
  } catch {
    throw new EngineError('artifact-corrupt', `The record of ${ref.type} ${ref.key} is damaged`)
  }
  if (manifest.type !== ref.type) throw new EngineError('artifact-wrong-type', `Expected ${ref.type}, but this artifact is ${manifest.type}`)
  return manifest
}

/** True only if every file exists and matches its recorded hash. */
export async function verifyFiles(store: Store, manifest: ArtifactManifest): Promise<boolean> {
  for (const file of manifest.files) {
    const path = `${artifactDir(manifest)}/${file.name}`
    if (!(await store.exists(path))) return false
    if (hashText(await store.read(path)) !== file.sha256) return false
  }
  return true
}

export type Artifact = { manifest: ArtifactManifest; read: (name: string) => Promise<string> }

const open = (store: Store, manifest: ArtifactManifest): Artifact => ({
  manifest,
  read: async (name) => {
    if (!manifest.files.some((f) => f.name === name)) throw new EngineError('artifact-missing', `${manifest.type} has no file ${name}`)
    return store.read(`${artifactDir(manifest)}/${name}`)
  },
})

/** Loads an artifact for use, refusing the wrong type or anything that has changed since it was made. */
export async function loadArtifact(store: Store, ref: ArtifactRef): Promise<Artifact> {
  const manifest = await readManifest(store, ref)
  if (!manifest) throw new EngineError('artifact-missing', `${ref.type} ${ref.key} doesn't exist`, 'Run the earlier step again')
  if (!(await verifyFiles(store, manifest))) throw new EngineError('artifact-corrupt', `Files of ${ref.type} ${ref.key} have changed or gone missing`, 'Run the step again to rebuild them')
  return open(store, manifest)
}

export const openVerified = open

export type TraceNode = { type: ArtifactType; key: string; step: string; parameters: unknown; tools: ToolIdentity[]; createdAt: string; inputs: TraceNode[] }

/** Follows an artifact back through everything that produced it. */
export async function traceArtifact(store: Store, ref: ArtifactRef): Promise<TraceNode> {
  const manifest = await readManifest(store, ref)
  if (!manifest) throw new EngineError('artifact-missing', `${ref.type} ${ref.key} doesn't exist`)
  const inputs: TraceNode[] = []
  for (const input of manifest.inputs) inputs.push(await traceArtifact(store, input))
  return { type: manifest.type, key: manifest.key, step: `${manifest.step.name}@${manifest.step.version}`, parameters: manifest.parameters, tools: manifest.tools, createdAt: manifest.createdAt, inputs }
}
