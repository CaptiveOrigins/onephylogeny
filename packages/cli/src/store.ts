import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Store } from '@captiveorigins/onephylogeny-engine'

/**
 * The engine's store on the local disk, rooted at the workspace. A write goes to a temporary file that is then
 * renamed over the old one, so a crash or a failed write never leaves half a file, and the old file stays as it was.
 */
export const nodeStore = (root: string): Store => ({
  read: async (p) => readFileSync(join(root, p), 'utf8'),
  write: async (p, text) => {
    const file = join(root, p)
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temp, text)
      renameSync(temp, file)
    } catch (error) {
      try {
        rmSync(temp, { force: true })
      } catch {
        // The original error matters more than a leftover temporary file.
      }
      throw error
    }
  },
  append: async (p, text) => {
    const file = join(root, p)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, text)
  },
  exists: async (p) => existsSync(join(root, p)),
  folders: async (p) => {
    const dir = join(root, p)
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  },
})
