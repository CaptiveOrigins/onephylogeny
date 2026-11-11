import { invoke } from '@tauri-apps/api/core'
import { resolveResource } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { fetch as nativeFetch } from '@tauri-apps/plugin-http'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { load } from '@tauri-apps/plugin-store'
import type { Platform } from './platform'
import { parseEcoregions } from './RegionMapSection'
import { loadSettings, saveSettings } from './updates'

const settings = () => load('settings.json', { autoSave: true, defaults: {} })

export async function createMacPlatform(): Promise<Platform> {
  let root = (await (await settings()).get<string>('workspace')) ?? null
  // About 8 MB, so it's read once, and only when a panel with ecoregion tags is shown. A failure isn't cached.
  let outlines: ReturnType<NonNullable<Platform['ecoregions']>> | null = null
  const full = (p: string) => {
    if (!root) throw new Error('Choose a workspace folder first')
    return `${root}/${p}`
  }
  return {
    kind: 'mac',
    // No signing key yet, so releases have no update file. Add checkForUpdates back with the key.
    settings: { load: loadSettings, save: saveSettings },
    root: () => root,
    chooseWorkspace: async () => {
      const picked = await open({ directory: true, title: 'Choose a workspace folder' })
      if (typeof picked !== 'string') return null
      root = picked
      await (await settings()).set('workspace', picked)
      return picked
    },
    store: {
      read: (p) => readTextFile(full(p)),
      write: async (p, text) => {
        const file = full(p)
        await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true })
        const temp = `${file}.tmp`
        await writeTextFile(temp, text)
        await rename(temp, file)
      },
      append: async (p, text) => {
        const file = full(p)
        await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true })
        await writeTextFile(file, text, { append: true })
      },
      exists: (p) => exists(full(p)),
    },
    list: async (dir) => {
      if (!(await exists(full(dir)))) return []
      return (await readDir(full(dir))).filter((e) => e.isDirectory).map((e) => e.name).sort()
    },
    // The browser engine can't call NCBI directly, so requests go through the app's native HTTP layer.
    fetch: (url, init) => nativeFetch(url, init),
    tools: {
      version: (tool) => invoke<string | null>('tool_version', { tool }),
      run: (tool, args, { cwd }) => invoke('run_tool', { tool, args, cwd }),
    },
    openTextFile: async () => {
      const picked = await open({ multiple: false, title: 'Open a sequence file', filters: [{ name: 'FASTA', extensions: ['fasta', 'fa', 'fas', 'fna', 'txt'] }] })
      if (typeof picked !== 'string') return null
      return { name: picked.split('/').pop() ?? picked, text: await readTextFile(picked) }
    },
    reveal: (p) => revealItemInDir(full(p)),
    print: () => invoke('print_window'),
    // The outlines ship inside the app (ADR 0008), built from the RESOLVE release when the app is built. Nothing is fetched.
    ecoregions: () => {
      outlines ??= (async () => {
        const file = await resolveResource('resources/ecoregions.json')
        if (!(await exists(file))) throw new Error("the outlines aren't in this copy of the app")
        let text: string
        try {
          text = await readTextFile(file)
        } catch (e) {
          throw new Error(`the outlines file couldn't be read (${e instanceof Error ? e.message : String(e)})`)
        }
        return parseEcoregions(text)
      })()
      outlines.catch(() => { outlines = null })
      return outlines
    },
  }
}
