import { canonicalJson, LOCATION_EVIDENCE, type Diagnostic, type FindingStatus, type Id, type PanelBundle } from '@captiveorigins/onephylogeny-core'

import { hashText } from './artifacts.js'
import type { Store } from './context.js'
import { EngineError } from './errors.js'
import { ENGINE } from './run.js'

/**
 * A panel as a dataset (roadmap stage 2; docs/architecture/adr/0006-panel-dataset.md). Beside the sealed `panel.json`
 * and `panel.fasta`, a built panel's folder carries example sequences with the results they gave when it was built,
 * and a manifest of every file's hash. `verifyDataset` checks the hashes and the seal, then reruns the examples, so a
 * panel copied to another machine, or read by another version of the software, is shown to give the same answers.
 */

/** What an example must give again. Statuses per group and how each pair resolved, or the codes that refused it. */
export type ExampleExpectation =
  | { outcome: 'result'; statuses: Record<Id, FindingStatus>; pairs: Record<string, string> }
  | { outcome: 'refused'; codes: string[] }

export type PanelExample = {
  id: string
  kind: 'member' | 'fragment' | 'control'
  /** Why this example is here, in words. */
  note: string
  sequence: string
  expected: ExampleExpectation
}

export type PanelExamples = { schemaVersion: 1; panel: { id: Id; version: string; checksum: string }; producedBy: { name: string; version: string }[]; examples: PanelExample[] }

/** The files a dataset's manifest covers, when present. `artifact.json` is left out: it points into one machine's store. */
export const DATASET_FILES = ['panel.json', 'panel.fasta', 'validation.json', 'diagnostics.json', 'examples.json', 'README.md'] as const

export type DatasetManifest = {
  schemaVersion: 1
  panel: { id: Id; version: string; checksum: string }
  files: Record<string, string>
  /** The software that wrote the examples. A copy is compatible with any version whose rerun of the examples matches. */
  builtWith?: { name: string; version: string }[]
  /** The panel's sources, as it cites them. */
  citations?: string[]
}

/**
 * A README for the folder, so the dataset reads without the tool: what the panel is for, its groups and regions, what it
 * can't speak to, how far it has been validated, how to check a copy, and what to cite. Built from the sealed panel
 * alone, so it never holds a coordinate or a site.
 */
export function datasetReadme(bundle: PanelBundle, examples: PanelExamples): string {
  const p = bundle.panel
  const lines = [
    `# ${p.id} ${p.version}`,
    '',
    `A OnePhylogeny reference panel for ${p.marker.kind === 'gene' ? `the ${p.marker.gene} gene` : 'one marker'}, status **${p.status}**. It says which sampled maternal-line population a sequence is closer to. That is never proof of where an animal was collected.`,
    '',
    '## Groups',
    '',
    '| Group | Region | Records |',
    '| --- | --- | --- |',
    ...p.groups.map((g) => `| ${g.label} | ${g.region ?? '(none)'} | ${g.evidence.length} |`),
    '',
    '## Limits',
    '',
    ...(p.notCovered.length ? p.notCovered.map((n) => `- Not covered: ${n}`) : ['- The panel states nothing about what it does not cover.']),
    ...(p.validatedScope.length ? p.validatedScope.map((v) => `- Validated: ${v}`) : ['- No claim has passed validation yet, so every result is exploratory.']),
    '- Statuses follow stated rules and are not probabilities.',
    '',
    '## Checking a copy',
    '',
    `\`onephylogeny verify --dir .\` checks every file against \`dataset.json\`, checks the seal (checksum \`${p.checksum}\`), and reruns the ${examples.examples.length} examples in \`examples.json\`. A copy is good only if all of them still give the answers recorded there.`,
    '',
    '## Files',
    '',
    '- `panel.json`: the sealed panel. `panel.fasta`: its reference and aligned records.',
    '- `validation.json`: the validation report. `diagnostics.json`: notes from the build.',
    '- `examples.json`: sequences with the answers they gave. `dataset.json`: every file\'s SHA-256.',
    '',
    '## Cite',
    '',
    ...(p.sources.length ? p.sources.map((s) => `- ${s.citation}${s.url ? ` ${s.url}` : ''}`) : ['- No sources recorded.']),
    '',
    `Built with ${examples.producedBy.map((t) => `${t.name} ${t.version}`).join(', ')}.`,
    '',
  ]
  return lines.join('\n')
}

export type SampleTester = (sequence: string, queryId: string, bundle: PanelBundle) => { result: { findings: { group: Id; status: FindingStatus }[]; pairs: { a: Id; b: Id; state: string; favors?: Id }[] } | null; diagnostics: Diagnostic[] }

export function expectationOf(outcome: ReturnType<SampleTester>): ExampleExpectation {
  if (!outcome.result) return { outcome: 'refused', codes: [...new Set(outcome.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code))].sort() }
  return {
    outcome: 'result',
    statuses: Object.fromEntries(outcome.result.findings.map((f) => [f.group, f.status]).sort(([a], [b]) => String(a).localeCompare(String(b)))),
    pairs: Object.fromEntries(outcome.result.pairs.map((p): [string, string] => [`${p.a}|${p.b}`, p.state === 'resolved' ? `resolved:${p.favors}` : p.state]).sort(([a], [b]) => a.localeCompare(b))),
  }
}

const ungap = (aligned: string) => aligned.replace(/[-.]/g, '')
const FRAGMENT = 300

/**
 * Chooses examples from the panel itself, the same way every time: per group, the member with location evidence
 * covering the most columns (ties by record ID); a 300-base fragment from the middle of the first of those; and a
 * control that isn't the marker at all, which the panel must refuse.
 */
export function chooseExamples(bundle: PanelBundle): Omit<PanelExample, 'expected'>[] {
  const out: Omit<PanelExample, 'expected'>[] = []
  for (const group of [...bundle.panel.groups].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const best = group.evidence
      .filter((e) => LOCATION_EVIDENCE.includes(e.provenanceClass) && bundle.sequences[e.record])
      .map((e) => ({ record: e.record, length: ungap(bundle.sequences[e.record]!).length }))
      .sort((a, b) => b.length - a.length || String(a.record).localeCompare(String(b.record)))[0]
    if (best) out.push({ id: `member-${group.id}`, kind: 'member', note: `The longest located member of ${group.label ?? group.id} (${best.record})`, sequence: ungap(bundle.sequences[best.record]!) })
  }
  const first = out[0]
  if (first && first.sequence.length >= FRAGMENT + 100) {
    const start = Math.floor((first.sequence.length - FRAGMENT) / 2)
    out.push({ id: `fragment-${first.id.slice('member-'.length)}`, kind: 'fragment', note: `${FRAGMENT} bases from the middle of ${first.id}`, sequence: first.sequence.slice(start, start + FRAGMENT) })
  }
  out.push({ id: 'control-not-marker', kind: 'control', note: 'A repeat that is not the marker; the panel must refuse it', sequence: 'ACGTTGCA'.repeat(60) })
  return out
}

export function makeExamples(bundle: PanelBundle, test: SampleTester): PanelExamples {
  const { panel } = bundle
  if (!panel.checksum) throw new EngineError('panel-unsealed', 'Examples can only be made for a sealed panel')
  return {
    schemaVersion: 1,
    panel: { id: panel.id, version: panel.version, checksum: panel.checksum },
    producedBy: [ENGINE],
    examples: chooseExamples(bundle).map((e) => ({ ...e, expected: expectationOf(test(e.sequence, e.id, bundle)) })),
  }
}

/** Reruns every example. Each one that no longer gives what it gave at build time is an error. */
export function checkExamples(examples: PanelExamples, bundle: PanelBundle, test: SampleTester): Diagnostic[] {
  const out: Diagnostic[] = []
  if (examples.panel.checksum !== bundle.panel.checksum) return [{ severity: 'error', code: 'examples-wrong-panel', message: `The examples were made for panel checksum ${examples.panel.checksum}, not this one` }]
  if (!examples.examples.length) out.push({ severity: 'error', code: 'no-examples', message: 'The dataset has no examples, so nothing shows it still gives the same answers' })
  for (const e of examples.examples) {
    const now = expectationOf(test(e.sequence, e.id, bundle))
    if (canonicalJson(now) !== canonicalJson(e.expected))
      out.push({ severity: 'error', code: 'example-changed', message: `Example ${e.id} (${e.kind}) gave ${describe(now)}, not ${describe(e.expected)} as when the panel was built`, path: `examples.${e.id}` })
  }
  return out
}

function describe(x: ExampleExpectation): string {
  if (x.outcome === 'refused') return `a refusal (${x.codes.join(', ') || 'no code'})`
  return Object.entries(x.statuses).map(([g, s]) => `${g} ${s}`).join(', ')
}

/** Writes `examples.json` and then `dataset.json` into a built panel's folder. Refuses to replace different examples. */
export async function writeDataset(store: Store, dir: string, bundle: PanelBundle, test: SampleTester): Promise<DatasetManifest> {
  const examples = makeExamples(bundle, test)
  const text = `${JSON.stringify(examples, null, 2)}\n`
  if (await store.exists(`${dir}/examples.json`)) {
    const existing = JSON.parse(await store.read(`${dir}/examples.json`)) as PanelExamples
    if (canonicalJson(existing.examples) !== canonicalJson(examples.examples) || existing.panel.checksum !== examples.panel.checksum)
      throw new EngineError('examples-differ', `Panel ${bundle.panel.id} ${bundle.panel.version} already has different examples`, 'Run verify to see which ones changed; a panel version keeps the examples it was published with')
  } else await store.write(`${dir}/examples.json`, text)
  const kept = JSON.parse(await store.read(`${dir}/examples.json`)) as PanelExamples
  await store.write(`${dir}/README.md`, datasetReadme(bundle, kept))
  const files: Record<string, string> = {}
  for (const f of DATASET_FILES) if (await store.exists(`${dir}/${f}`)) files[f] = hashText(await store.read(`${dir}/${f}`))
  const manifest: DatasetManifest = { schemaVersion: 1, panel: examples.panel, files, builtWith: kept.producedBy, citations: bundle.panel.sources.map((s) => (s.url ? `${s.citation} ${s.url}` : s.citation)) }
  await store.write(`${dir}/dataset.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/**
 * Everything a copy of a panel needs to be trusted: the manifest's hashes, the panel's seal, and the examples rerun.
 * Reads only. `load` is the engine's `loadPanel`, which checks the seal.
 */
export async function verifyDataset(store: Store, dir: string, load: (store: Store, dir: string) => Promise<PanelBundle>, test: SampleTester): Promise<{ diagnostics: Diagnostic[]; checked: { files: number; examples: number } }> {
  const diagnostics: Diagnostic[] = []
  let files = 0
  if (!(await store.exists(`${dir}/dataset.json`))) diagnostics.push({ severity: 'error', code: 'no-dataset-manifest', message: 'This folder has no dataset.json, so its files can\'t be checked against their hashes' })
  else {
    const manifest = JSON.parse(await store.read(`${dir}/dataset.json`)) as DatasetManifest
    for (const [name, hash] of Object.entries(manifest.files)) {
      files++
      if (!(await store.exists(`${dir}/${name}`))) diagnostics.push({ severity: 'error', code: 'file-missing', message: `${name} is listed in dataset.json but missing`, path: name })
      else if (hashText(await store.read(`${dir}/${name}`)) !== hash) diagnostics.push({ severity: 'error', code: 'file-changed', message: `${name} has changed since the dataset was written`, path: name })
    }
    for (const required of ['panel.json', 'panel.fasta', 'examples.json'])
      if (!(required in manifest.files)) diagnostics.push({ severity: 'error', code: 'file-not-covered', message: `dataset.json doesn't cover ${required}`, path: required })
  }
  let bundle: PanelBundle
  try {
    bundle = await load(store, dir)
  } catch (e) {
    diagnostics.push({ severity: 'error', code: e instanceof EngineError ? e.code : 'panel-unreadable', message: (e as Error).message })
    return { diagnostics, checked: { files, examples: 0 } }
  }
  if (!(await store.exists(`${dir}/examples.json`))) {
    diagnostics.push({ severity: 'error', code: 'no-examples', message: 'This panel has no examples.json, so nothing shows it still gives the same answers' })
    return { diagnostics, checked: { files, examples: 0 } }
  }
  const examples = JSON.parse(await store.read(`${dir}/examples.json`)) as PanelExamples
  diagnostics.push(...checkExamples(examples, bundle, test))
  return { diagnostics, checked: { files, examples: examples.examples.length } }
}
