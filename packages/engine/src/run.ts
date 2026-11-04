import type { Profile, Run, RunEvent } from '@captiveorigins/onephylogeny-core'
import { AcquireError } from '@captiveorigins/onephylogeny-acquire'
import { artifactDir, hashText, openVerified, readManifest, stepKey, verifyFiles, type Artifact, type ArtifactManifest, type ArtifactRef, type ArtifactType, type ToolIdentity } from './artifacts.js'
import type { EngineContext } from './context.js'
import { EngineError } from './errors.js'

/** Bump with each engine release. Recorded in every run, panel and result. */
export const ENGINE_VERSION = '0.1.0-alpha.0'
export const ENGINE: ToolIdentity = { name: 'onephylogeny-engine', version: ENGINE_VERSION }

export const profilePaths = (profileId: string) => ({
  profile: `profiles/${profileId}/profile.json`,
  curation: `profiles/${profileId}/curation.json`,
  latest: `profiles/${profileId}/latest-run.txt`,
  run: (id: string) => `profiles/${profileId}/runs/${id}`,
  panel: (id: string, version: string) => `profiles/${profileId}/panels/${id}-${version}`,
  results: `profiles/${profileId}/results`,
})

export const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`
const stamp = (ctx: EngineContext) => (ctx.now?.() ?? new Date()).toISOString()

/** Writes the log as the run goes. A log that can't be written never stops the work. */
class RunLog {
  readonly events: RunEvent[] = []
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly ctx: EngineContext, private readonly file: string) {}
  add(level: RunEvent['level'], step: string, message: string, data?: Record<string, unknown>) {
    const event: RunEvent = { at: stamp(this.ctx), level, step, message, ...(data ? { data } : {}) }
    this.events.push(event)
    this.ctx.onEvent?.(event)
    const { store } = this.ctx
    const write = store.append
      ? () => store.append!(this.file, `${JSON.stringify(event)}\n`)
      : () => store.write(this.file, `${this.events.map((e) => JSON.stringify(e)).join('\n')}\n`)
    this.pending = this.pending.then(write).catch(() => {})
  }
  flush() { return this.pending }
}

export type RunScope = {
  ctx: EngineContext
  run: Run
  dir: string
  log: RunLog['add']
  /** Throws at a safe point if the run was cancelled. */
  checkpoint: () => void
  /** Lets the interface breathe during long calculations, and honors cancellation. */
  breathe: () => Promise<void>
  step: <T extends StepSpec>(spec: T) => Promise<Artifact>
}

export type StepSpec = {
  type: ArtifactType
  step: { name: string; version: number }
  inputs: ArtifactRef[]
  parameters: unknown
  tools?: ToolIdentity[]
  /** Does the work, passing each output to `put`. An output can be registered if a tool wrote it directly. */
  run: (put: (name: string, text: string) => Promise<void>, dir: string, register: (name: string) => Promise<void>) => Promise<void>
  /** Checks outputs after the work. Returns a problem in words, or null. */
  ensure?: (read: (name: string) => Promise<string>) => Promise<string | null>
}

/** Runs one step, or reuses it if its key matches and every output still verifies. */
async function runStep(scope: RunScope, spec: StepSpec): Promise<Artifact> {
  const { store } = scope.ctx
  const tools = spec.tools ?? []
  const key = stepKey({ type: spec.type, step: spec.step, inputs: spec.inputs, parameters: spec.parameters, tools })
  const ref: ArtifactRef = { type: spec.type, key }
  scope.checkpoint()
  const existing = await readManifest(store, ref)
  if (existing && (await verifyFiles(store, existing))) {
    scope.log('info', spec.step.name, 'Reused earlier output: inputs and settings are unchanged', { status: 'reused', key })
    scope.run.artifacts.push({ ...ref, reused: true })
    return openVerified(store, existing)
  }
  const dir = artifactDir(ref)
  scope.log('info', spec.step.name, 'Running', { status: 'running', key })
  const files: ArtifactManifest['files'] = []
  const put = async (name: string, text: string) => {
    await store.write(`${dir}/${name}`, text)
    files.push({ name, sha256: hashText(text) })
  }
  const register = async (name: string) => { files.push({ name, sha256: hashText(await store.read(`${dir}/${name}`)) }) }
  await spec.run(put, dir, register)
  scope.checkpoint()
  if (spec.ensure) {
    const problem = await spec.ensure((name) => store.read(`${dir}/${name}`))
    if (problem) throw new EngineError('step-output-invalid', `${spec.step.name} produced invalid output: ${problem}`)
  }
  const manifest: ArtifactManifest = { schemaVersion: 1, type: spec.type, key, step: spec.step, inputs: spec.inputs, parameters: spec.parameters, tools, files, createdAt: stamp(scope.ctx) }
  await store.write(`${dir}/manifest.json`, json(manifest))
  scope.log('info', spec.step.name, 'Finished', { status: 'finished', key })
  scope.run.artifacts.push({ ...ref, reused: false })
  return openVerified(store, manifest)
}

const newRunId = (ctx: EngineContext, kind: Run['kind']) => `${stamp(ctx).replace(/[:.]/g, '-')}-${kind}`

const toEngineError = (e: unknown): unknown => {
  if (e instanceof AcquireError) return new EngineError('source-failed', e.message, 'Check your connection and try again. Anything already downloaded is kept')
  return e
}

/** Gives any piece of work an honest record: written before it starts, finalized however it ends. */
export async function withRun<T>(ctx: EngineContext, profile: Profile, kind: Run['kind'], work: (scope: RunScope) => Promise<T>): Promise<{ value: T; run: Run }> {
  const P = profilePaths(profile.id)
  const id = newRunId(ctx, kind)
  const dir = P.run(id)
  const run: Run = { schemaVersion: 1, id, kind, profile, artifacts: [], tools: [ENGINE], status: 'running', startedAt: stamp(ctx), events: [], outputs: [], diagnostics: [] }
  await ctx.store.write(`${dir}/run.json`, json(run))
  const log = new RunLog(ctx, `${dir}/events.jsonl`)
  const checkpoint = () => { if (ctx.signal?.aborted) throw new EngineError('cancelled', 'Cancelled') }
  let lastBreath = Date.now()
  const scope: RunScope = {
    ctx, run, dir,
    log: (level, step, message, data) => log.add(level, step, message, data),
    checkpoint,
    breathe: async () => {
      checkpoint()
      if (Date.now() - lastBreath > 30) {
        await new Promise((r) => setTimeout(r, 0))
        lastBreath = Date.now()
        checkpoint()
      }
    },
    step: (spec) => runStep(scope, spec),
  }
  const finish = async (status: Run['status']) => {
    await log.flush()
    run.status = status
    run.finishedAt = stamp(ctx)
    run.events = log.events
    await ctx.store.write(`${dir}/run.json`, json(run))
  }
  try {
    const value = await work(scope)
    await finish('succeeded')
    return { value, run }
  } catch (raw) {
    const e = toEngineError(raw)
    const cancelled = e instanceof EngineError && e.code === 'cancelled'
    scope.log(cancelled ? 'warning' : 'error', 'run', cancelled ? 'Cancelled. Finished steps are kept and will be reused' : e instanceof Error ? e.message : String(e))
    // Reporting the failure must not hide it, even if the disk is what failed.
    await finish(cancelled ? 'cancelled' : 'failed').catch(() => {})
    throw e
  }
}
