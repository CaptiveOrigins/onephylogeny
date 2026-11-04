/** Every failure has a stable code, plain words, and what to do next. */
export type ErrorCode =
  | 'invalid-profile' | 'empty-search' | 'empty-panel' | 'source-failed' | 'reference-missing' | 'raw-file-changed'
  | 'artifact-missing' | 'artifact-wrong-type' | 'artifact-corrupt' | 'step-output-invalid' | 'panel-version-exists'
  | 'panel-outdated' | 'panel-missing' | 'tool-missing' | 'tool-failed' | 'run-missing' | 'cancelled'

export class EngineError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly action?: string) {
    super(message)
    this.name = 'EngineError'
  }
}

export const isCancelled = (e: unknown) => e instanceof EngineError && e.code === 'cancelled'
