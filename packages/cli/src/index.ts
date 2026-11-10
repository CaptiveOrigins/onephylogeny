#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { curationFromCsv, curationToCsv, parseCuration, parseFasta, parseProfile, reportMarkdown, sampleReport, type Result } from '@captiveorigins/onephylogeny-core'
import { NcbiClient, suggestOutgroups } from '@captiveorigins/onephylogeny-acquire'
import { buildPanelFromRun, comparePanelVersions, buildTree, EngineError, fetchAndAnchor, isCancelled, loadPanel, loadRunRecords, profilePaths, readCurationHistory, saveCuration, routeSample, runSample, testSample, traceArtifact, verifyDataset, writeDataset, type ArtifactType, type EngineContext, type ToolRunner } from '@captiveorigins/onephylogeny-engine'
import { nodeStore } from './store.js'

const USAGE = `onephylogeny <command> --workspace DIR --profile ID [options]

  doctor                   Check native tools
  outgroups                Suggest outgroups outward from the ingroup
  fetch                    Download, anchor and gate records; write the sheet and log
  panel                    Build and validate a panel from the latest run
  test --fasta FILE        Test local sequences against the panel
  tree [--start N --end N] Build a tree from one window with IQ-TREE
  curation export          Print the curation sheet (CSV) for the latest run's records
  curation import --file F [--apply --reason TEXT] [--by NAME]
                           Check a filled-in sheet and show what would change; --apply saves it, with the reason in the history
  curation history [--record ID]
                           Every saved change, when, by whom and why
  trace --type T --key K   Show everything that produced an artifact
  compare --a V --b V      Compare two built panel versions
  verify --dir DIR         Check a built panel folder: file hashes, seal, and its examples rerun (no profile needed)
  dataset --dir DIR        Add examples and a manifest to a panel built before they existed (no profile needed)
  route --fasta FILE --panels DIR
                           Which panels under DIR apply to each sequence (no profile needed)
  report --dir DIR --result FILE [--json]
                           A self-contained report for one saved result, as Markdown (no profile needed)

Options: --events (print JSON Lines events). Set NCBI_API_KEY to fetch faster.`

const args = process.argv.slice(2)
const command = args[0]
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(`--${name}`)

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
  if (command === 'route') {
    const file = flag('fasta')
    const root = flag('panels')
    if (!file || !root) throw new Error('--fasta and --panels are required')
    // Every folder under --panels holding a panel.json, at any depth up to three.
    const found: string[] = []
    const walk = (dir: string, depth: number) => {
      if (existsSync(join(dir, 'panel.json'))) found.push(dir)
      if (depth < 3) for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(join(dir, e.name), depth + 1)
    }
    walk(resolve(root), 0)
    // A panel that can't be read (an older format, or one that fails its seal) is listed as skipped, never used.
    const bundles = []
    const skipped: { folder: string; reason: string }[] = []
    for (const d of found) {
      try {
        bundles.push(await loadPanel(nodeStore(d), '.'))
      } catch (e) {
        skipped.push({ folder: d, reason: (e as Error).message })
      }
    }
    if (skipped.length) console.error(JSON.stringify({ skipped }, null, 2))
    for (const e of parseFasta(readFileSync(file, 'utf8'))) console.log(JSON.stringify({ sample: e.id, suggestions: routeSample(e.sequence, bundles) }, null, 2))
    return
  }
  if (command === 'report') {
    const dir = flag('dir')
    const file = flag('result')
    if (!dir || !file) throw new Error('--dir and --result are required')
    const { panel } = await loadPanel(nodeStore(resolve(dir)), '.')
    // A saved outcome holds the result beside its diagnostics; a bare result works too.
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { result?: Result | null; diagnostics?: { message: string }[] } & Partial<Result>
    const result = 'findings' in saved ? (saved as Result) : saved.result
    if (!result) throw new Error(`This sample was refused, so there is no result to report: ${(saved.diagnostics ?? []).map((d) => d.message).join('; ')}`)
    const report = sampleReport(panel, result)
    process.stdout.write(has('json') ? `${JSON.stringify(report, null, 2)}\n` : reportMarkdown(report))
    return
  }
  if (command === 'verify' || command === 'dataset') {
    const dir = flag('dir')
    if (!dir) throw new Error('--dir is required')
    const store = nodeStore(resolve(dir))
    if (command === 'dataset') {
      const manifest = await writeDataset(store, '.', await loadPanel(store, '.'), testSample)
      console.log(JSON.stringify(manifest, null, 2))
      return
    }
    const r = await verifyDataset(store, '.', loadPanel, testSample)
    console.log(JSON.stringify({ verified: !r.diagnostics.some((d) => d.severity === 'error'), ...r }, null, 2))
    if (r.diagnostics.some((d) => d.severity === 'error')) process.exitCode = 1
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
  } else if (command === 'curation') {
    const records = await loadRunRecords(store, profile.id)
    const curation = (await store.exists(P.curation)) ? parseCuration(await store.read(P.curation)) : { schemaVersion: 1 as const, records: {} }
    if (args[1] === 'export') return void process.stdout.write(curationToCsv(curation, records))
    if (args[1] === 'history') return void console.log(JSON.stringify(await readCurationHistory(store, profile.id, flag('record')), null, 2))
    if (args[1] !== 'import') throw new Error('Use: curation export | import --file F [--apply --reason TEXT] | history [--record ID]')
    const file = flag('file')
    if (!file) throw new Error('--file is required')
    const r = curationFromCsv(readFileSync(file, 'utf8'), curation, { knownRecords: records.map((x) => x.version || x.accession), groups: profile.panel?.groups.map((g) => g.id) ?? [] })
    const errors = r.diagnostics.filter((d) => d.severity === 'error')
    const reason = flag('reason')
    if (has('apply') && !reason) throw new Error('--apply needs --reason, so the history says why these changes were made')
    const by = flag('by')
    const applied = has('apply') && !errors.length && r.changes.length > 0
    if (applied) await saveCuration(store, profile.id, r.curation, { reason: reason!, ...(by ? { by } : {}) })
    console.log(JSON.stringify({ applied, changed: r.changes.length, changes: r.changes, diagnostics: r.diagnostics }, null, 2))
    if (errors.length) process.exitCode = 1
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
