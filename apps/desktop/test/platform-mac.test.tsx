import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mocked Tauri file system: this checks how the Mac app saves, not the real disk.
const fs = vi.hoisted(() => ({ files: new Map<string, string>(), written: [] as string[], failWrite: false, workspace: '/ws' as string | undefined }))
vi.mock('@tauri-apps/plugin-store', () => ({ load: async () => ({ get: async () => fs.workspace, set: async () => {} }) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), ask: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (p: string) => fs.files.has(p),
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async (p: string) => fs.files.get(p) ?? Promise.reject(new Error(`no file ${p}`)),
  writeTextFile: async (p: string, text: string, opts?: { append?: boolean }) => {
    fs.written.push(p)
    if (fs.failWrite) throw new Error('disk full')
    fs.files.set(p, opts?.append ? (fs.files.get(p) ?? '') + text : text)
  },
  rename: async (from: string, to: string) => {
    fs.files.set(to, fs.files.get(from)!)
    fs.files.delete(from)
  },
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))

import { createMacPlatform } from '../src/platform-mac'

beforeEach(() => {
  fs.files.clear()
  fs.written.length = 0
  fs.failWrite = false
  fs.workspace = '/ws'
})

describe('the Mac store', () => {
  it('replaces a file whole, through a temporary file', async () => {
    const { store } = await createMacPlatform()
    await store.write('a/panel.json', 'one')
    await store.write('a/panel.json', 'two')
    // Never written in place, so a crash mid-write can't leave half a file.
    expect(fs.written).toEqual(['/ws/a/panel.json.tmp', '/ws/a/panel.json.tmp'])
    expect([...fs.files]).toEqual([['/ws/a/panel.json', 'two']])
    expect(await store.read('a/panel.json')).toBe('two')
  })

  it('keeps the old file when a write fails', async () => {
    const { store } = await createMacPlatform()
    await store.write('a/panel.json', 'one')
    fs.failWrite = true
    await expect(store.write('a/panel.json', 'two')).rejects.toThrow(/disk full/)
    expect(fs.files.get('/ws/a/panel.json')).toBe('one')
  })

  it('appends to logs, and writes nothing before a workspace is chosen', async () => {
    const { store } = await createMacPlatform()
    await store.append!('log.jsonl', 'a\n')
    await store.append!('log.jsonl', 'b\n')
    expect(fs.files.get('/ws/log.jsonl')).toBe('a\nb\n')
    fs.workspace = undefined
    fs.files.clear()
    const none = await createMacPlatform()
    await expect(none.store.write('a.json', 'x')).rejects.toThrow(/workspace folder/)
    expect(fs.files.size).toBe(0)
  })
})
