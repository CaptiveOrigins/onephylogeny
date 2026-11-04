import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { load } from '@tauri-apps/plugin-store'
import { check } from '@tauri-apps/plugin-updater'
import type { Settings } from './platform'

const store = () => load('settings.json', { autoSave: true, defaults: {} })

export async function loadSettings(): Promise<Settings> {
  const s = await store()
  return { autoUpdate: (await s.get<boolean>('autoUpdate')) ?? true, appearance: (await s.get<Settings['appearance']>('appearance')) ?? 'auto' }
}

export async function saveSettings(settings: Settings) {
  const s = await store()
  await s.set('autoUpdate', settings.autoUpdate)
  await s.set('appearance', settings.appearance)
}

/** Looks for a newer signed release on GitHub, asks before installing, then restarts. Returns a message, or null when there's nothing to say. */
export async function checkForUpdates(manual: boolean): Promise<string | null> {
  try {
    const update = await check()
    if (!update) return manual ? 'You have the latest version.' : null
    // The web view ignores window.confirm on macOS, so ask with a native dialog.
    if (!(await ask(`OnePhylogeny ${update.version} is available. Install it now? The app restarts afterwards.`, { title: 'Update available' }))) return `Update ${update.version} is available.`
    await update.downloadAndInstall()
    await relaunch()
    return null
  } catch (e) {
    return manual ? `Could not check for updates: ${(e as Error).message}` : null
  }
}
