import type { FetchLike } from '@captiveorigins/onephylogeny-acquire'
import type { Store, ToolRunner } from '@captiveorigins/onephylogeny-engine'

/** What the interface needs from the machine. The Mac app and the browser preview each provide one. */
export type Platform = {
  kind: 'mac' | 'preview'
  root: () => string | null
  chooseWorkspace: () => Promise<string | null>
  store: Store
  list: (dir: string) => Promise<string[]>
  fetch: FetchLike
  tools?: ToolRunner
  openTextFile: () => Promise<{ name: string; text: string } | null>
  reveal: (path: string) => Promise<void>
}

export const isMac = () => '__TAURI_INTERNALS__' in window
