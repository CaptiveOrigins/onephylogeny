import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeStore } from '../src/store'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'onephylogeny-store-'))
})
afterEach(() => {
  chmodSync(root, 0o755)
  for (const dir of readdirSync(root, { recursive: true, withFileTypes: true })) if (dir.isDirectory()) chmodSync(join(dir.parentPath, dir.name), 0o755)
  rmSync(root, { recursive: true, force: true })
})

describe('the CLI file store', () => {
  it('writes, reads, appends and reports what exists, making folders as needed', async () => {
    const store = nodeStore(root)
    expect(await store.exists('runs/r1/log.jsonl')).toBe(false)
    await store.write('runs/r1/sheet.json', '{"a":1}')
    await store.append('runs/r1/log.jsonl', 'one\n')
    await store.append('runs/r1/log.jsonl', 'two\n')
    expect(await store.read('runs/r1/sheet.json')).toBe('{"a":1}')
    expect(await store.read('runs/r1/log.jsonl')).toBe('one\ntwo\n')
    expect(await store.exists('runs/r1/log.jsonl')).toBe(true)
  })

  it('lists the folders inside a folder, sorted, leaving out files, and none for a folder that is missing', async () => {
    const store = nodeStore(root)
    await store.write('panels/p-2/panel.json', '{}')
    await store.write('panels/p-1/panel.json', '{}')
    await store.write('panels/notes.txt', 'x')
    expect(await store.folders!('panels')).toEqual(['p-1', 'p-2'])
    expect(await store.folders!('nothing-here')).toEqual([])
  })

  it('replaces a file whole and leaves no temporary file', async () => {
    const store = nodeStore(root)
    await store.write('panel.json', 'old')
    await store.write('panel.json', 'new')
    expect(readFileSync(join(root, 'panel.json'), 'utf8')).toBe('new')
    expect(readdirSync(root)).toEqual(['panel.json'])
  })

  it.skipIf(process.getuid?.() === 0)('keeps the old file when a write fails, and cleans up', async () => {
    const store = nodeStore(root)
    mkdirSync(join(root, 'panels'))
    writeFileSync(join(root, 'panels/panel.json'), 'old')
    chmodSync(join(root, 'panels'), 0o555)
    await expect(store.write('panels/panel.json', 'new')).rejects.toThrow()
    expect(readFileSync(join(root, 'panels/panel.json'), 'utf8')).toBe('old')
    expect(readdirSync(join(root, 'panels'))).toEqual(['panel.json'])
  })

  it('removes the temporary file when the rename fails', async () => {
    const store = nodeStore(root)
    mkdirSync(join(root, 'taken/inside'), { recursive: true })
    await expect(store.write('taken', 'text')).rejects.toThrow()
    expect(existsSync(join(root, 'taken/inside'))).toBe(true)
    expect(readdirSync(root)).toEqual(['taken'])
  })
})
