import type { RunEvent, ValidationInput, ValidationReport } from '@captiveorigins/onephylogeny-core'
import type { NcbiOptions } from '@captiveorigins/onephylogeny-acquire'

/** Where files live. A folder on disk, in the CLI and the Mac app. */
export interface Store {
  read(path: string): Promise<string>
  /** Must be atomic: a crash leaves the old file or the new one, never half of it. */
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** Adds to a log without rewriting it. Optional: without it, logs are written whole. */
  append?(path: string, text: string): Promise<void>
}

/** How native programs run. Only tree building needs one. */
export interface ToolRunner {
  version(tool: string): Promise<string | null>
  run(tool: string, args: string[], options: { cwd: string }): Promise<{ code: number; stdout: string; stderr: string }>
}

export type ValidationReports = { blocks: ValidationReport; groups: ValidationReport }

/** Heavy pure calculations, which an app can run off its interface thread. */
export type Compute = { validate?: (input: ValidationInput) => Promise<ValidationReports> }

export type EngineContext = {
  store: Store
  ncbi: Omit<NcbiOptions, 'log'>
  tools?: ToolRunner
  now?: () => Date
  onEvent?: (event: RunEvent) => void
  /** Cancels a run at its next safe point. */
  signal?: AbortSignal
  compute?: Compute
}
