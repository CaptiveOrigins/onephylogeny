#!/usr/bin/env node
// Published JSON Schemas (roadmap stage 2, item 4), generated from the TypeScript types so they can't drift.
//
//   node scripts/schemas.mjs           write packages/*/schemas/*.schema.json
//   node scripts/schemas.mjs --check   exit 1 if any committed schema differs from the types (run in tests)
//
// The generator's own type check is skipped: `pnpm typecheck` checks these types, and the generator bundles its own
// TypeScript, which can disagree with ours about settings.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGenerator } from 'ts-json-schema-generator'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Which types are published, and as what. `version` matches the type's own schemaVersion. */
export const SCHEMAS = [
  { pkg: 'core', file: 'src/model.ts', type: 'Profile', name: 'profile', version: 1 },
  { pkg: 'core', file: 'src/model.ts', type: 'Curation', name: 'curation', version: 1 },
  { pkg: 'core', file: 'src/model.ts', type: 'Panel', name: 'panel', version: 2 },
  { pkg: 'core', file: 'src/model.ts', type: 'Result', name: 'result', version: 2 },
  { pkg: 'engine', file: 'src/dataset.ts', type: 'PanelExamples', name: 'examples', version: 1 },
  { pkg: 'engine', file: 'src/dataset.ts', type: 'DatasetManifest', name: 'dataset', version: 1 },
]

export function generate(s) {
  const dir = path.join(root, 'packages', s.pkg)
  const schema = createGenerator({ path: path.join(dir, s.file), tsconfig: path.join(dir, 'tsconfig.json'), type: s.type, skipTypeCheck: true, expose: 'export', topRef: true, jsDoc: 'extended', additionalProperties: false }).createSchema(s.type)
  // A URN, not a URL: it names the format and version without promising a web address.
  return { $id: `urn:onephylogeny:schema:${s.name}:v${s.version}`, title: `OnePhylogeny ${s.name}, schema version ${s.version}`, ...schema }
}

export const target = (s) => path.join(root, 'packages', s.pkg, 'schemas', `${s.name}.schema.json`)
const text = (schema) => `${JSON.stringify(schema, null, 2)}\n`

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  let stale = 0
  for (const s of SCHEMAS) {
    const out = text(generate(s))
    const file = target(s)
    if (check) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== out) {
        stale++
        console.error(`${path.relative(root, file)} doesn't match ${s.type}. Run: node scripts/schemas.mjs`)
      }
    } else {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, out)
      console.log(`wrote ${path.relative(root, file)}`)
    }
  }
  if (stale) process.exit(1)
}
