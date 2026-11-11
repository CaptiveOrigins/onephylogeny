#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assessRead, auditGroups, checkPrimers, chimeraCandidates, compareWithGroups, comparisonMarkdown, parseVcf, readAbif, curationFromCsv, panelMethods, curationToCsv, parseCuration, parseFasta, parseProfile, reportMarkdown, sampleReport, type Result } from '@captiveorigins/onephylogeny-core'
import { lookupPaper, NcbiClient, paced, publicListings, suggestOutgroups } from '@captiveorigins/onephylogeny-acquire'
import { buildPanelFromRun, runHypothesis, testHypothesis, testHypothesisOnPanel, comparePanelVersions, panelVersionComparison, buildTree, EngineError, fetchAndAnchor, isCancelled, loadPanel, loadRunRecords, profilePaths, readCurationHistory, saveCuration, routeSample, runSample, testSample, traceArtifact, verifyDataset, writeDataset, type ArtifactType, type EngineContext, type HypothesisPlan, type ToolRunner } from '@captiveorigins/onephylogeny-engine'
import { claimFromFlags, planText, verdictText } from './hypothesis.js'
import { joinPair, type AssessedRead } from './sanger.js'
import { parseGroups, snpsTable } from './snps.js'
import { chosenKinds, sourcesText } from './sources.js'
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
  hypothesis --claim KIND [claim options] [--version V] [--plan-only] [--json]
                           Put a claim to the saved panels and results, read only. It prints the stated test first,
                           then one verdict (refuted, not refuted, untestable with this data, tool or data problem) with
                           what it rests on and its caveats. --plan-only stops after the stated test. Any verdict exits 0.
                           Claims: sample-in-group --sample S --group G | groups-distinct --groups G,H --window W |
                           panel-changed-call --a V --b V --record R [--group G] | possibly-novel --sample S.
                           With --dir PANEL instead of a profile, only that panel folder is read (no saved results)
  compare --a V --b V [--markdown]
                           Compare two built panel versions: records, groups, settings, claims, as JSON. --markdown
                           prints it for reading, with each version's validation outcomes by window side by side
  verify --dir DIR         Check a built panel folder: file hashes, seal, and its examples rerun (no profile needed)
  dataset --dir DIR        Add examples and a manifest to a panel built before they existed (no profile needed)
  lookup --title T [--authors A]
                           Propose DOI and PubMed links for a study from Crossref and Europe PMC (nothing is attached)
  methods --dir DIR        Methods text and citations for a built panel, from what it records
  audit --dir DIR          Check a built panel's groups against its sequences, window by window (flags only)
  chimeras --dir DIR       Records whose windows point to different groups: possible chimeras (flags only)
  route --fasta FILE --panels DIR
                           Which panels under DIR apply to each sequence (no profile needed)
  report --dir DIR --result FILE [--json]
                           A self-contained report for one saved result, as Markdown (no profile needed)
  sanger --ab1 FILE [--min-quality N] [--min-length N] [--json]
                           Read a Sanger chromatogram: trim by quality, mask low bases as N, flag strong second peaks,
                           and print the kept read as FASTA (no profile needed)
  sanger --ab1 FORWARD --reverse REVERSE --dir DIR [--json]
                           Join a forward and a reverse read on the panel's reference: good bases that disagree become N
                           and are listed (reference columns, counting from 1). One unusable read: the other is used alone
  snps --vcf FILE --groups FILE [--min-shared N] [--json]
                           Compare SNP genotypes with groups: per group, how many samples' nearest SNP neighbour shares
                           their group, and mean distances within and between. GROUPS is CSV (sample,group) or a JSON
                           object. Default --min-shared 100. Descriptions, never probabilities (no profile needed)
  sources --taxon NAME_OR_TAXID [--sra] [--genomes] [--occurrences] [--bold] [--json]
                           What public services list for a taxon: SRA runs, NCBI Datasets genomes, GBIF and iDigBio
                           occurrence counts, BOLD counts (default: all). Listings and counts only, never coordinates
                           or downloads. Needs the network. A service that fails is named, and the exit code is 1
                           (no profile needed)
  primers --dir DIR --forward SEQ --reverse SEQ [--reference FASTA --offset N] [--max-mismatches N]
                           Which of a panel's windows a primer pair can cover. Give a longer reference and the marker's
                           offset in it when the primers sit outside the marker (no profile needed)

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
  if (command === 'lookup') {
    const title = flag('title')
    if (!title) throw new Error('--title is required')
    const authors = flag('authors')
    console.log(JSON.stringify(await lookupPaper(paced((url, init) => fetch(url, init)), { title, ...(authors ? { authors } : {}) }), null, 2))
    return
  }
  if (command === 'sources') {
    const taxon = flag('taxon')
    if (!taxon || taxon.startsWith('--')) throw new Error('--taxon is required: an NCBI Taxonomy ID or a scientific name')
    const http = (url: string, init?: RequestInit) => fetch(url, init)
    // The tool name only: never an email. NCBI_API_KEY, if set, is sent to NCBI and never printed.
    const client = new NcbiClient({ fetch: http, tool: 'onephylogeny', ...(process.env.NCBI_API_KEY ? { apiKey: process.env.NCBI_API_KEY } : {}) })
    const listing = await publicListings({ fetch: http, client }, taxon, { only: chosenKinds(has) })
    process.stdout.write(has('json') ? `${JSON.stringify(listing, null, 2)}\n` : sourcesText(listing))
    if (listing.failed.length) process.exitCode = 1
    return
  }
  if (command === 'methods') {
    const dir = flag('dir')
    if (!dir) throw new Error('--dir is required')
    const m = panelMethods((await loadPanel(nodeStore(resolve(dir)), '.')).panel)
    process.stdout.write(`${m.text}\n## Sources\n\n${m.citations.map((c) => `- ${c}`).join('\n')}\n`)
    return
  }
  if (command === 'chimeras') {
    const dir = flag('dir')
    if (!dir) throw new Error('--dir is required')
    console.log(JSON.stringify(chimeraCandidates(await loadPanel(nodeStore(resolve(dir)), '.')), null, 2))
    return
  }
  if (command === 'audit') {
    const dir = flag('dir')
    if (!dir) throw new Error('--dir is required')
    console.log(JSON.stringify(auditGroups(await loadPanel(nodeStore(resolve(dir)), '.')), null, 2))
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
  if (command === 'sanger') {
    const file = flag('ab1')
    if (!file) throw new Error('--ab1 is required')
    const reverseFile = flag('reverse')
    const dir = flag('dir')
    if (has('reverse') && (!reverseFile || reverseFile.startsWith('--'))) throw new Error('--reverse needs a file: the reverse read (.ab1)')
    if (reverseFile && !dir) throw new Error("Joining two reads needs the panel's reference: add --dir with a built panel folder")
    const num = (name: string) => (flag(name) !== undefined ? Number(flag(name)) : undefined)
    const settings = { ...(num('min-quality') !== undefined ? { minQuality: num('min-quality')! } : {}), ...(num('min-length') !== undefined ? { minLength: num('min-length')! } : {}) }
    if (reverseFile) {
      const reference = (await loadPanel(nodeStore(resolve(dir!)), '.')).referenceSequence
      if (!reference) throw new Error("This panel carries no reference sequence, so the reads can't be joined. Build the panel again.")
      const reads = [file, reverseFile].map((f) => {
        const read = readAbif(new Uint8Array(readFileSync(f)))
        return { file: f, sampleName: read.sampleName, instrument: read.instrument, assessment: assessRead(read, settings) }
      }) as [AssessedRead & { instrument: string | null }, AssessedRead & { instrument: string | null }]
      const pair = joinPair(reads[0], reads[1], reference)
      if (has('json')) {
        console.log(JSON.stringify({ forward: { file, sampleName: reads[0].sampleName, instrument: reads[0].instrument, ...reads[0].assessment }, reverse: { file: reverseFile, sampleName: reads[1].sampleName, instrument: reads[1].instrument, ...reads[1].assessment }, ...pair }, null, 2))
        if (pair.status === 'refused') process.exitCode = 1
        return
      }
      for (const [label, r] of [['Forward', reads[0]], ['Reverse', reads[1]]] as const) for (const n of r.assessment.notes) console.error(`${label} (${r.file}): ${n}`)
      if (pair.status === 'refused') throw new Error(pair.reason)
      for (const n of pair.notes) console.error(n)
      const fasta = (s: string) => s.match(/.{1,70}/g)!.join('\n')
      if (pair.status === 'single') {
        const used = reads.find((r) => r.file === pair.used[0])!
        process.stdout.write(`>${used.sampleName ?? used.file} status=${used.assessment.status} kept=${used.assessment.kept!.start + 1}-${used.assessment.kept!.end} alone\n${fasta(pair.sequence)}\n`)
        return
      }
      console.error(`Reference columns ${pair.span.start} to ${pair.span.end}: ${pair.columns.both} with a good base from both reads, ${pair.columns.forwardOnly} from the forward only, ${pair.columns.reverseOnly} from the reverse only.`)
      console.error(`Conflicts: ${pair.conflicts.length}${pair.conflicts.length ? ` (reference column${pair.conflicts.length === 1 ? '' : 's'} ${pair.conflicts.join(', ')}, counting from 1)` : ''}.`)
      process.stdout.write(`>${reads[0].sampleName ?? file} joined columns=${pair.span.start}-${pair.span.end} conflicts=${pair.conflicts.length}\n${fasta(pair.sequence)}\n`)
      return
    }
    const read = readAbif(new Uint8Array(readFileSync(file)))
    const a = assessRead(read, settings)
    if (has('json')) return console.log(JSON.stringify({ sampleName: read.sampleName, instrument: read.instrument, ...a }, null, 2))
    for (const n of a.notes) console.error(n)
    if (a.status === 'failed') throw new Error(`${file}: the read failed, so there is no sequence to use`)
    if (a.status === 'short') console.error(`Not usable: too short. The kept bases are printed anyway, for inspection.`)
    process.stdout.write(`>${read.sampleName ?? file} status=${a.status} kept=${a.kept!.start + 1}-${a.kept!.end}\n${a.sequence.match(/.{1,70}/g)!.join('\n')}\n`)
    return
  }
  if (command === 'snps') {
    const vcfFile = flag('vcf')
    const groupsFile = flag('groups')
    if (!vcfFile || !groupsFile) throw new Error('--vcf and --groups are required')
    const given = flag('min-shared')
    const minShared = given === undefined ? 100 : Number(given)
    if (!Number.isInteger(minShared) || minShared < 1) throw new Error('--min-shared must be a whole number of sites, 1 or more')
    const vcf = parseVcf(readFileSync(vcfFile, 'utf8'))
    const groups = parseGroups(readFileSync(groupsFile, 'utf8'))
    const result = compareWithGroups(vcf, groups, minShared)
    if (has('json')) return console.log(JSON.stringify({ samples: vcf.samples.length, sites: vcf.sites.length, skipped: vcf.skipped, minSharedSites: minShared, ...result }, null, 2))
    process.stdout.write(snpsTable(vcf, result, minShared))
    return
  }
  if (command === 'primers') {
    const dir = flag('dir')
    const forward = flag('forward')
    const reverse = flag('reverse')
    if (!dir || !forward || !reverse) throw new Error('--dir, --forward and --reverse are required')
    const bundle = await loadPanel(nodeStore(resolve(dir)), '.')
    const given = flag('reference')
    const reference = given ? parseFasta(readFileSync(given, 'utf8'))[0]?.sequence : bundle.referenceSequence
    if (!reference) throw new Error('This panel carries no reference sequence; give one with --reference')
    if (given && flag('offset') === undefined) throw new Error('With --reference, give --offset: where the marker starts in it (0-based)')
    const result = checkPrimers({ forward, reverse, reference, windows: bundle.panel.windows, markerOffset: given ? Number(flag('offset')) : 0, ...(flag('max-mismatches') !== undefined ? { maxMismatches: Number(flag('max-mismatches')) } : {}) })
    console.log(JSON.stringify(result, null, 2))
    if (result.status === 'refused') process.exitCode = 1
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
  if (command === 'hypothesis' && flag('dir')) {
    const store = nodeStore(resolve(flag('dir')!))
    const panelId = (await store.exists('panel.json')) ? (JSON.parse(await store.read('panel.json')) as { id?: string }).id : undefined
    const claim = claimFromFlags(flag, panelId)
    // Reads files only: the network is never needed, so any attempt fails loudly.
    const offline: EngineContext = { store, ncbi: { fetch: () => Promise.reject(new Error('The hypothesis command never uses the network')) } }
    return hypothesis(offline, await testHypothesisOnPanel(offline, '.', claim))
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
    if (has('markdown')) process.stdout.write(comparisonMarkdown(await panelVersionComparison(store, profile, a, b)))
    else console.log(JSON.stringify(await comparePanelVersions(store, profile, a, b), null, 2))
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
  } else if (command === 'hypothesis') {
    const claim = claimFromFlags(flag, profile.panel?.id)
    await hypothesis(ctx, await testHypothesis(ctx, profile, claim))
  } else if (command === 'trace') {
    const type = flag('type') as ArtifactType | undefined
    const key = flag('key')
    if (!type || !key) throw new Error('--type and --key are required')
    console.log(JSON.stringify(await traceArtifact(store, { type, key }), null, 2))
  } else throw new Error(`Unknown command ${command}\n\n${USAGE}`)
}

/** Prints the stated test, then, unless --plan-only, the verdict. Every verdict is an answer, so it exits 0. */
async function hypothesis(ctx: EngineContext, plan: HypothesisPlan) {
  if (has('plan-only')) return void process.stdout.write(has('json') ? `${JSON.stringify({ plan }, null, 2)}\n` : planText(plan))
  if (!has('json')) process.stdout.write(`${planText(plan)}\n`)
  const outcome = await runHypothesis(ctx, plan)
  process.stdout.write(has('json') ? `${JSON.stringify({ plan, outcome }, null, 2)}\n` : verdictText(outcome))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  if (e instanceof EngineError && e.action) console.error(`What to do: ${e.action}`)
  process.exit(isCancelled(e) ? 130 : 1)
})
