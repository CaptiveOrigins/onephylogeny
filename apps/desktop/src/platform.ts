import type { FetchLike } from '@captiveorigins/onephylogeny-acquire'
import type { Store, ToolRunner } from '@captiveorigins/onephylogeny-engine'
import type { Ecoregions } from '@captiveorigins/onephylogeny-react'

/** What the interface needs from the machine. The Mac app and the browser preview each provide one. */
export type Settings = { autoUpdate: boolean; appearance: 'auto' | 'light' | 'dark' }

export type Platform = {
  kind: 'mac' | 'preview'
  settings: { load: () => Promise<Settings>; save: (s: Settings) => Promise<void>; checkForUpdates?: (manual: boolean) => Promise<string | null> }
  root: () => string | null
  chooseWorkspace: () => Promise<string | null>
  store: Store
  list: (dir: string) => Promise<string[]>
  fetch: FetchLike
  tools?: ToolRunner
  openTextFile: () => Promise<{ name: string; text: string } | null>
  /** Picks chromatogram (.ab1) files and reads their bytes. Null when nothing was chosen. Absent where files can't be opened, such as the browser preview. */
  openChromatograms?: () => Promise<{ name: string; bytes: Uint8Array }[] | null>
  reveal: (path: string) => Promise<void>
  print?: () => Promise<void>
  /** The region map's outlines (ADR 0008), read from inside the app. Absent where a copy has none, such as the browser preview. */
  ecoregions?: () => Promise<Ecoregions>
}

export const isMac = () => '__TAURI_INTERNALS__' in window
