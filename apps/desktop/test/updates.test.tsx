import { describe, expect, it, vi } from 'vitest'

// Mocked Tauri: this checks the Mac platform's wiring, not the real app.
const check = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-updater', () => ({ check }))
vi.mock('@tauri-apps/plugin-store', () => ({ load: async () => ({ get: async () => undefined, set: async () => {} }) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), ask: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readTextFile: vi.fn(), rename: vi.fn(), writeTextFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))

import { createMacPlatform } from '../src/platform-mac'

describe('updates', () => {
  it('offers no update check while releases are unsigned', async () => {
    const platform = await createMacPlatform()
    expect(platform.settings.checkForUpdates).toBeUndefined()
    expect(check).not.toHaveBeenCalled()
  })
})
