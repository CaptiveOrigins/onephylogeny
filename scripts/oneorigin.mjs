#!/usr/bin/env node
// OneOrigin brand copy: build, lock and check. No dependencies; the same file in OnePhylogeny, OnePedigree and OneTaxonomy.
//
// The source is OnePhylogeny's docs/oneorigin/. Each tool carries a copy in brand/oneorigin/, and brand/oneorigin.lock
// records the source repo, the source commit and a sha256 of every copied file, plus the CSS files built from the copy.
//
//   node scripts/oneorigin.mjs build [--prefix ophy --out apps/desktop/src/oneorigin.css]
//       Writes CSS custom properties from brand/oneorigin/tokens.json under the tool's prefix. With --prefix and --out it
//       writes that file and records it in the lock; with neither it rewrites every file the lock records.
//   node scripts/oneorigin.mjs lock --source <path to a OnePhylogeny checkout> [--copy] [--commit <sha>]
//       Writes brand/oneorigin.lock. Refuses unless brand/oneorigin/ matches the source's docs/oneorigin/ byte for byte
//       (--copy copies it first). The commit is the source checkout's HEAD, which must have docs/oneorigin/ committed.
//   node scripts/oneorigin.mjs check [--source <path or URL>] [--offline]
//       Fails if brand/oneorigin/ differs from the lock (a hand edit, a missing or an extra file) or a built CSS file
//       differs from what build writes. Warns, without failing, if the source has moved ahead of the lock, or if the
//       source can't be reached to tell. The source defaults to this repo's docs/oneorigin/ when it has one, and
//       otherwise to the lock's repo on GitHub (plain file downloads, not the GitHub API).
//
// Options for every command: --root <repo> (default: the folder above this script).

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SOURCE_PATH = 'docs/oneorigin'
export const COPY_PATH = 'brand/oneorigin'
export const LOCK_PATH = 'brand/oneorigin.lock'
export const SOURCE_REPO = 'https://github.com/CaptiveOrigins/onephylogeny'
export const SOURCE_BRANCH = 'main'

const HEX = /^#[0-9a-f]{6}$/
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export const sha256 = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex')

/** Every file under dir, as sorted forward-slash paths relative to it. */
export function listFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

/** sha256 of every file under dir. */
export function hashFiles(dir) {
  return Object.fromEntries(listFiles(dir).map((f) => [f, sha256(readFileSync(join(dir, f)))]))
}

/** Checks tokens.json against the rules tokens.schema.json states, without a validator. Returns a list of problems. */
export function validateTokens(tokens) {
  const problems = []
  const colors = (group, where) => {
    if (!group || typeof group !== 'object') return problems.push(`${where} is missing`)
    for (const [name, value] of Object.entries(group)) {
      if (!NAME.test(name)) problems.push(`${where}.${name}: names are lowercase words joined by hyphens`)
      for (const mode of ['light', 'dark']) if (!HEX.test(value?.[mode] ?? '')) problems.push(`${where}.${name}.${mode} isn't a lowercase #rrggbb color`)
    }
  }
  if (tokens?.schemaVersion !== 1) problems.push(`schemaVersion is ${JSON.stringify(tokens?.schemaVersion)}; this script reads version 1`)
  colors(tokens?.color, 'color')
  for (const group of ['radius', 'size']) {
    for (const [name, value] of Object.entries(tokens?.[group] ?? {})) {
      if (!NAME.test(name)) problems.push(`${group}.${name}: names are lowercase words joined by hyphens`)
      if (typeof value?.px !== 'number' || value.px < 0) problems.push(`${group}.${name}.px isn't a length`)
    }
  }
  const prefixes = new Set()
  for (const [id, tool] of Object.entries(tokens?.tools ?? {})) {
    if (!/^[a-z]{2,4}$/.test(tool?.prefix ?? '')) problems.push(`tools.${id}.prefix isn't 2 to 4 lowercase letters`)
    if (prefixes.has(tool?.prefix)) problems.push(`tools.${id}.prefix ${tool.prefix} is used twice`)
    prefixes.add(tool?.prefix)
    for (const end of ['top', 'bottom']) if (!HEX.test(tool?.tile?.[end] ?? '')) problems.push(`tools.${id}.tile.${end} isn't a lowercase #rrggbb color`)
    colors(tool?.color, `tools.${id}.color`)
    for (const name of Object.keys(tool?.color ?? {})) {
      if (tokens?.color && name in tokens.color) problems.push(`tools.${id}.color.${name} would replace a shared color; shared colors stay shared`)
    }
  }
  if (prefixes.size === 0) problems.push('tools is empty')
  return problems
}

/** CSS custom properties for the tool with this prefix. Pure: the same tokens give the same bytes. */
export function buildCss(tokens, prefix) {
  const problems = validateTokens(tokens)
  if (problems.length) throw new Error(`tokens.json has problems:\n- ${problems.join('\n- ')}`)
  const entry = Object.entries(tokens.tools).find(([, t]) => t.prefix === prefix)
  if (!entry) throw new Error(`No tool in tokens.json has the prefix "${prefix}". Known: ${Object.values(tokens.tools).map((t) => t.prefix).join(', ')}.`)
  const [id, tool] = entry
  const colors = { ...tokens.color, ...tool.color }
  const v = (name) => `--${prefix}-${name}`
  const modeLines = (mode, indent) => Object.entries(colors).map(([name, c]) => `${indent}${v(name)}: ${c[mode]};`)
  const lengths = [
    ...Object.entries(tokens.radius ?? {}).map(([name, l]) => `  ${v(`radius-${name}`)}: ${l.px}px;`),
    ...Object.entries(tokens.size ?? {}).map(([name, l]) => `  ${v(name)}: ${l.px}px;`),
  ]
  return [
    `/* OneOrigin tokens for ${tool.name} (--${prefix}-), written by \`node scripts/oneorigin.mjs build\` from ${COPY_PATH}/tokens.json.`,
    `   Don't edit by hand: \`node scripts/oneorigin.mjs check\` fails when this differs from what build writes. Tool: ${id}. */`,
    ':root {',
    ...modeLines('light', '  '),
    ...lengths,
    `  ${v('tile-top')}: ${tool.tile.top};`,
    `  ${v('tile-bottom')}: ${tool.tile.bottom};`,
    '}',
    '@media (prefers-color-scheme: dark) {',
    "  :root:not([data-appearance='light']) {",
    ...modeLines('dark', '    '),
    '  }',
    '}',
    ":root[data-appearance='dark'] {",
    ...modeLines('dark', '  '),
    '}',
    '',
  ].join('\n')
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const readLock = (root) => (existsSync(join(root, LOCK_PATH)) ? readJson(join(root, LOCK_PATH)) : null)
const tokensOf = (root) => readJson(join(root, COPY_PATH, 'tokens.json'))

/** Writes one CSS file, or every file the lock records. Returns the paths written. */
export function build(root, { prefix, out } = {}) {
  if ((prefix && !out) || (out && !prefix)) throw new Error('build needs both --prefix and --out, or neither.')
  const lock = readLock(root)
  const targets = prefix ? { [out]: prefix } : (lock?.outputs ?? {})
  if (Object.keys(targets).length === 0) throw new Error(`Nothing to build: give --prefix and --out, or record outputs in ${LOCK_PATH}.`)
  const tokens = tokensOf(root)
  for (const [path, p] of Object.entries(targets)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), buildCss(tokens, p))
  }
  if (prefix && lock) {
    lock.outputs = Object.fromEntries(Object.entries({ ...lock.outputs, [out]: prefix }).sort(([a], [b]) => a.localeCompare(b)))
    writeJson(join(root, LOCK_PATH), lock)
  }
  return Object.keys(targets)
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Writes the lock from a local source checkout. Refuses when the copy doesn't match the source. */
export function lock(root, { source, copy = false, commit } = {}) {
  if (!source) throw new Error('lock needs --source <path to a OnePhylogeny checkout>.')
  const sourceDir = join(resolve(source), SOURCE_PATH)
  if (!existsSync(join(sourceDir, 'tokens.json'))) throw new Error(`${sourceDir} has no tokens.json; --source must be a OnePhylogeny checkout.`)
  if (!commit) {
    const dirty = git(resolve(source), 'status', '--porcelain', '--', SOURCE_PATH)
    if (dirty) throw new Error(`The source's ${SOURCE_PATH} has uncommitted changes, so no commit holds what would be copied:\n${dirty}`)
    commit = git(resolve(source), 'rev-parse', 'HEAD')
  }
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`"${commit}" isn't a commit hash.`)
  const copyDir = join(root, COPY_PATH)
  if (copy && resolve(sourceDir) !== resolve(copyDir)) {
    rmSync(copyDir, { recursive: true, force: true })
    cpSync(sourceDir, copyDir, { recursive: true })
  }
  const files = hashFiles(copyDir)
  const diff = compare(hashFiles(sourceDir), files)
  if (diff.length) throw new Error(`${COPY_PATH} doesn't match the source (use --copy to copy it):\n- ${diff.join('\n- ')}`)
  const previous = readLock(root)
  const value = {
    about: `Copy of ${SOURCE_REPO} ${SOURCE_PATH} at the commit below. Written by \`node scripts/oneorigin.mjs lock\`; \`check\` fails on any file that differs.`,
    source: { repo: SOURCE_REPO, branch: SOURCE_BRANCH, path: SOURCE_PATH, commit },
    copy: COPY_PATH,
    files,
    outputs: previous?.outputs ?? {},
  }
  writeJson(join(root, LOCK_PATH), value)
  return value
}

/** Differences between two {file: sha256} maps, described from `actual`'s side. */
export function compare(expected, actual) {
  const out = []
  for (const f of Object.keys(expected)) {
    if (!(f in actual)) out.push(`${f}: missing`)
    else if (expected[f] !== actual[f]) out.push(`${f}: changed`)
  }
  for (const f of Object.keys(actual)) if (!(f in expected)) out.push(`${f}: not in the source`)
  return out
}

async function sourceHashes(root, lockValue, { source, offline }) {
  const local = source && !/^https?:\/\//.test(source) ? join(resolve(source), SOURCE_PATH) : !source ? join(root, SOURCE_PATH) : null
  if (local && existsSync(local) && statSync(local).isDirectory()) return { where: local, files: hashFiles(local), complete: true }
  if (source && local) throw new Error(`${local} doesn't exist`)
  if (offline) throw new Error('offline')
  const base = (source ?? lockValue.source.repo).replace(/\.git$/, '').replace(/\/$/, '')
  const m = base.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/)
  const raw = m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${lockValue.source.branch ?? SOURCE_BRANCH}/${lockValue.source.path ?? SOURCE_PATH}` : base
  const files = {}
  for (const f of Object.keys(lockValue.files)) {
    const res = await fetch(`${raw}/${f}`, { signal: AbortSignal.timeout(10_000) })
    if (res.status === 404) continue
    if (!res.ok) throw new Error(`${raw}/${f} answered ${res.status}`)
    files[f] = sha256(Buffer.from(await res.arrayBuffer()))
  }
  // Only the locked files can be fetched by name, so a file added at the source isn't seen this way.
  return { where: raw, files, complete: false }
}

/** Compares the copy with the lock. Returns { errors, warnings }; errors fail CI, warnings don't. */
export async function check(root, { source, offline = false } = {}) {
  const errors = []
  const warnings = []
  const lockValue = readLock(root)
  if (!lockValue) return { errors: [`${LOCK_PATH} is missing. Write it with \`node scripts/oneorigin.mjs lock --source <OnePhylogeny checkout>\`.`], warnings }
  for (const d of compare(lockValue.files ?? {}, hashFiles(join(root, COPY_PATH)))) {
    errors.push(`${COPY_PATH}/${d.replace(': not in the source', ': not in the lock')}. The copy must match the lock; change the source in OnePhylogeny's ${SOURCE_PATH} and copy it again.`)
  }
  if (errors.length === 0) {
    let tokens = null
    try {
      tokens = tokensOf(root)
    } catch (e) {
      errors.push(`${COPY_PATH}/tokens.json can't be read: ${e.message}`)
    }
    for (const [path, prefix] of Object.entries(tokens ? (lockValue.outputs ?? {}) : {})) {
      const file = join(root, path)
      let expected
      try {
        expected = buildCss(tokens, prefix)
      } catch (e) {
        errors.push(`${path}: ${e.message}`)
        continue
      }
      if (!existsSync(file)) errors.push(`${path} is missing. Run \`node scripts/oneorigin.mjs build\`.`)
      else if (readFileSync(file, 'utf8') !== expected) errors.push(`${path} differs from what build writes from the tokens. Run \`node scripts/oneorigin.mjs build\`, and don't edit it by hand.`)
    }
  }
  try {
    const src = await sourceHashes(root, lockValue, { source, offline })
    const ahead = compare(lockValue.files ?? {}, src.files).map((d) => d.replace(': missing', ': not at the source').replace(': not in the source', ': added at the source'))
    if (ahead.length) warnings.push(`The source differs from the lock (${src.where}): ${ahead.join(', ')}. If the source has moved ahead, copy it again and rewrite the lock; if the lock points at a commit not yet on ${lockValue.source.branch ?? SOURCE_BRANCH}, this clears once it lands.`)
    if (!src.complete && !ahead.length) warnings.push(`Checked the locked files at ${src.where}; a file added there since wouldn't show.`)
  } catch (e) {
    warnings.push(`Couldn't check whether the source has moved ahead (${e.message === 'offline' ? 'offline' : e.message}). The copy itself was checked against the lock.`)
  }
  return { errors, warnings }
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--copy' || a === '--offline') opts[a.slice(2)] = true
    else if (['--prefix', '--out', '--source', '--root', '--commit'].includes(a)) {
      if (rest[i + 1] === undefined) throw new Error(`${a} needs a value.`)
      opts[a.slice(2)] = rest[++i]
    } else throw new Error(`Unknown option ${a}.`)
  }
  return { command, opts }
}

async function main(argv) {
  const { command, opts } = parseArgs(argv)
  const root = resolve(opts.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  const notice = (kind, text) => console.log(process.env.GITHUB_ACTIONS ? `::${kind}::${text.replace(/\n/g, '%0A')}` : `${kind === 'error' ? 'Error' : 'Warning'}: ${text}`)
  if (command === 'build') {
    for (const p of build(root, opts)) console.log(`Wrote ${p}`)
  } else if (command === 'lock') {
    const value = lock(root, opts)
    console.log(`Wrote ${LOCK_PATH}: ${Object.keys(value.files).length} files from ${value.source.repo} at ${value.source.commit}.`)
  } else if (command === 'check') {
    const { errors, warnings } = await check(root, opts)
    for (const w of warnings) notice('warning', w)
    for (const e of errors) notice('error', e)
    if (errors.length) {
      console.log(`OneOrigin check failed: ${errors.length} problem${errors.length === 1 ? '' : 's'}.`)
      return 1
    }
    const n = Object.keys(readLock(root).files).length
    console.log(`OneOrigin check passed: ${n} files match ${LOCK_PATH}, and every built CSS file is current.`)
  } else {
    console.log('Usage: node scripts/oneorigin.mjs build|lock|check [options]. See the top of this file.')
    return command ? 1 : 0
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    },
  )
}
