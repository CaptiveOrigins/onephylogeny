#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseCuration, parseFasta, parseProfile } from '@captiveorigins/onephylogeny-core'
import { NcbiClient, suggestOutgroups } from '@captiveorigins/onephylogeny-acquire'
import { buildPanelFromRun, comparePanelVersions, buildTree, EngineError, fetchAndAnchor, isCancelled, profilePaths, runSample, traceArtifact, type ArtifactType, type EngineContext, type Store, type ToolRunner } from '@captiveorigins/onephylogeny-engine'

const USAGE = `onephylogeny <command> --workspace DIR --profile ID [options]

  doctor                   Check native tools
  outgroups                Suggest outgroups outward from the ingroup
  fetch                    Download, anchor and gate records; write the sheet and log
  panel                    Build and validate a panel from the latest run
  test --fasta FILE        Test local sequences against the panel
  tree [--start N --end N] Build a tree from one window with IQ-TREE
  trace --type T --key K   Show everything that produced an artifact
  compare --a V --b V      Compare two built panel versions

Options: --events (print JSON Lines events). Set NCBI_API_KEY to fetch faster.`

const args = process.argv.slice(2)
const command = args[0]
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(`--${name}`)

const nodeStore = (root: string): Store => ({
  read: async (p) => readFileSync(join(root, p), 'utf8'),
  write: async (p, text) => {
    const file = join(root, p)
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, text)
    renameSync(temp, file)
  },
  append: async (p, text) => {
    const file = join(root, p)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, text)
  },
  exists: async (p) => existsSync(join(root, p)),
})

const exec = (tool: string, a: string[], cwd?: string) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((res) => {
    execFile(tool, a, { maxBuffer: 1 << 28, ...(cwd ? { cwd } : {}) }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 127) : 0
      res({ code, stdout: String(stdout), stderr: String(stderr || (err && !stderr ? err.message : '')) })
    })
  })

const tools: ToolRunner = {
  version: async (tool) => {
    const r = await exec(tool, ['--version'])
    return r.code === 127 ? null : (r.stdout || r.stderr).split('\n').find((l) => l.trim())?.trim() ?? 'unknown'
  },
  run: (tool, a, { cwd }) => {
    mkdirSync(cwd, { recursive: true })
    return exec(tool, a, cwd)
  },
}

async function main() {
  if (!command || command === 'help' || has('help')) return console.log(USAGE)
  if (command === 'doctor') {
    console.log(JSON.stringify({ iqtree3: await tools.version('iqtree3'), note: 'Fetching, anchoring, panels and sample tests need no native tools.' }, null, 2))
    return
  }
  const root = resolve(flag('workspace') ?? '.')
  const id = flag('profile')
  if (!id) throw new Error('--profile is required')
  const store = nodeStore(root)
  const P = profilePaths(id)
  const profile = parseProfile(await store.read(P.profile))
  const controller = new AbortController()
  process.on('SIGINT', () => controller.abort())
  const ctx: EngineContext = {
    store, tools, signal: controller.signal,
    ncbi: { fetch: (url, init) => fetch(url, init), tool: 'onephylogeny', ...(process.env.NCBI_API_KEY ? { apiKey: process.env.NCBI_API_KEY } : {}) },
    onEvent: (e) => { if (has('events')) console.log(JSON.stringify(e)); else if (e.level !== 'debug') console.error(`[${e.step}] ${e.message}`) },
  }
  if (command === 'outgroups') {
    const ladder = await suggestOutgroups(new NcbiClient(ctx.ncbi), profile.selection)
    console.log(JSON.stringify(ladder, null, 2))
  } else if (command === 'fetch') {
    const { run, outcomes } = await fetchAndAnchor(ctx, profile)
    console.log(JSON.stringify({ run: run.id, status: run.status, records: outcomes.length, passed: outcomes.filter((o) => o.status === 'passed').length, folder: join(root, P.run(run.id)) }, null, 2))
  } else if (command === 'panel') {
    const curation = parseCuration(await store.read(P.curation))
    const { bundle, diagnostics, validation, unassigned } = await buildPanelFromRun(ctx, profile, curation)
    console.log(JSON.stringify({ panel: bundle.panel.id, version: bundle.panel.version, checksum: bundle.panel.checksum, groups: bundle.panel.groups.map((g) => ({ id: g.id, records: g.evidence.length, coverage: g.coverage.map((c) => `${c.window}: ${c.records} records, ${c.blocks} sites${c.recordsNeeded ? `, needs ${c.recordsNeeded} more` : ''}`) })), pairs: bundle.panel.pairs.map((p) => `${p.a} / ${p.b} in ${p.window}: ${p.state === 'not_evaluable' ? 'not evaluable' : `${p.sites.length} sites`}`), claims: validation.claims.map((c) => ({ pair: `${c.a} / ${c.b}`, window: c.window, passed: c.passed, minColumns: c.minColumns, gates: c.gates.filter((g) => g.ran).map((g) => `${g.passed ? 'pass' : 'FAIL'} ${g.gate}: ${g.detail}`) })), scope: bundle.panel.validatedScope, unassigned, diagnostics, validation }, null, 2))
  } else if (command === 'test') {
    const file = flag('fasta')
    if (!file) throw new Error('--fasta is required')
    if (!profile.panel) throw new Error('The profile has no panel settings')
    for (const e of parseFasta(readFileSync(file, 'utf8'))) console.log(JSON.stringify(await runSample(ctx, profile, e.sequence, e.id), (k, v) => (k === 'aligned' || k === 'run' && typeof v === 'object' ? undefined : v), 2))
  } else if (command === 'compare') {
    const a = flag('a')
    const b = flag('b')
    if (!a || !b) throw new Error('--a and --b are required')
    console.log(JSON.stringify(await comparePanelVersions(store, profile, a, b), null, 2))
  } else if (command === 'tree') {
    const start = flag('start')
    const end = flag('end')
    const t = await buildTree(ctx, profile, { absoluteDir: root, ...(start && end ? { window: { start: Number(start), end: Number(end) } } : {}) })
    console.log(JSON.stringify({ tool: t.tool, version: t.version, tips: t.tips.length, newick: t.newick.trim() }, null, 2))
  } else if (command === 'trace') {
    const type = flag('type') as ArtifactType | undefined
    const key = flag('key')
    if (!type || !key) throw new Error('--type and --key are required')
    console.log(JSON.stringify(await traceArtifact(store, { type, key }), null, 2))
  } else throw new Error(`Unknown command ${command}\n\n${USAGE}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  if (e instanceof EngineError && e.action) console.error(`What to do: ${e.action}`)
  process.exit(isCancelled(e) ? 130 : 1)
})
