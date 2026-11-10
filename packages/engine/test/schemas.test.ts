import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const schema = (pkg: string, name: string) => JSON.parse(readFileSync(path.join(root, 'packages', pkg, 'schemas', `${name}.schema.json`), 'utf8'))

// Files the engine writes are validated against these in engine.test.ts ("panel dataset").
describe('published JSON Schemas (roadmap stage 2)', () => {
  it('match the TypeScript types they are generated from', () => {
    expect(() => execFileSync(process.execPath, [path.join(root, 'scripts/schemas.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow()
  }, 60_000)

  it('carry a stable ID naming the format and its version', () => {
    expect(schema('core', 'panel').$id).toBe('urn:onephylogeny:schema:panel:v2')
    expect(schema('core', 'result').$id).toBe('urn:onephylogeny:schema:result:v2')
    expect(schema('engine', 'examples').$id).toBe('urn:onephylogeny:schema:examples:v1')
  })
})
