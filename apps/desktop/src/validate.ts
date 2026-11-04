import type { ValidationInput } from '@captiveorigins/onephylogeny-core'
import type { ValidationReports } from '@captiveorigins/onephylogeny-engine'

/** Runs validation on another thread, because it rebuilds a panel for every held-out site. */
export function validateInWorker(input: ValidationInput): Promise<ValidationReports> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./validate.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<ValidationReports>) => { resolve(e.data); worker.terminate() }
    worker.onerror = (e) => { reject(new Error(e.message)); worker.terminate() }
    worker.postMessage(input)
  })
}
