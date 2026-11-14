import type { ValidationInput } from '@extantape/onephylogeny-core'
import { EngineError, type ValidationReports } from '@extantape/onephylogeny-engine'

const cancelled = () => new EngineError('cancelled', 'Cancelled')

/** Runs validation on another thread, because it rebuilds a panel for every held-out site. */
export function validateInWorker(input: ValidationInput, signal?: AbortSignal): Promise<ValidationReports> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled())
    const worker = new Worker(new URL('./validate.worker.ts', import.meta.url), { type: 'module' })
    // The worker never checks in, so stopping it is the only way Cancel can take effect before it finishes.
    const stop = () => { worker.terminate(); reject(cancelled()) }
    signal?.addEventListener('abort', stop, { once: true })
    const done = () => { signal?.removeEventListener('abort', stop); worker.terminate() }
    worker.onmessage = (e: MessageEvent<ValidationReports>) => { done(); resolve(e.data) }
    worker.onerror = (e) => { done(); reject(new Error(e.message)) }
    worker.postMessage(input)
  })
}
