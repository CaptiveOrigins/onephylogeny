import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseGenBank, type Curation, type Profile } from '@captiveorigins/onephylogeny-core'
import { buildPanelFromRun, fetchAndAnchor, runSample, type EngineContext, type Store } from '../src/index.js'

const text = readFileSync(new URL('../../../fixtures/golden/records.gb', import.meta.url), 'utf8')
const blocks = text.split(/^\/\/\s*$/m).filter((b) => b.includes('LOCUS')).map((b) => `${b.trimStart()}//\n`)
const byVersion = new Map(blocks.map((b) => [parseGenBank(b)[0]!.version, b]))
const sequenceOf = (version: string) => parseGenBank(byVersion.get(version)!)[0]!.sequence

const memory = (): Store => {
  const files = new Map<string, string>()
  return { read: async (p) => files.get(p)!, write: async (p, t) => void files.set(p, t), exists: async (p) => files.has(p) }
}
const context = (): EngineContext => ({
  store: memory(),
  ncbi: {
    sleep: async () => {}, delayMs: 0,
    fetch: async (url, init) => {
      const p = new URLSearchParams(init!.body)
      if (url.includes('esearch')) return { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { count: String(byVersion.size), idlist: [...byVersion.keys()] } }) }
      return { ok: true, status: 200, text: async () => p.get('id')!.split(',').map((i) => byVersion.get(i)!).join('') }
    },
  },
})

const profile: Profile = {
  schemaVersion: 1, id: 'golden', title: 'Golden',
  selection: { id: 's', title: 'S', taxa: [{ source: 'ncbi-taxonomy', id: '1' }], marker: { kind: 'gene', gene: 'cytb', products: ['cytochrome b'], organelle: 'mitochondrion' }, outgroups: [], exclude: [], filters: { minLength: 300 } },
  reference: { accession: 'NC_080265.1', codonStart: 0, geneticCode: 2 },
  panel: { id: 'golden-panel', version: '1', groups: [{ id: 'n', label: 'North' }, { id: 'nw', label: 'Northwest' }, { id: 'ne', label: 'Northeast' }, { id: 's', label: 'South' }], notCovered: ['Untested regions'], validatedScope: [], thresholds: { minOverlap: 100, tolerance: 1, minDiagnosticConflicts: 2 } },
}
const assign = (group: string, ...ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, { group, provenanceClass: 'wild-documented' as const, site: `${group}-${i}` }]))
const curation: Curation = { schemaVersion: 1, records: {
  ...assign('n', 'FM165591.1', 'FM165592.1', 'FM165593.1', 'FM165594.1', 'FN185746.1', 'FN185748.1'),
  ...assign('nw', 'FN185750.1', 'FN185751.1'),
  ...assign('ne', 'FM165598.1', 'FM165599.1', 'FM165600.1'),
  ...assign('s', 'FM165601.1', 'FM165602.1'),
} }

describe('golden run on real records', () => {
  it('goes from a search to explained results', async () => {
    const ctx = context()
    const { outcomes, run } = await fetchAndAnchor(ctx, profile)
    expect(run.status).toBe('succeeded')
    expect(outcomes).toHaveLength(15)
    const wrongGene = outcomes.find((o) => o.record === 'AY673445.1')!
    expect(wrongGene.status).toBe('excluded')
    expect(outcomes.filter((o) => o.status === 'excluded').map((o) => o.record)).toEqual(['AY673445.1'])

    const built = await buildPanelFromRun(ctx, profile, curation)
    expect(built.published).toBe(true)
    expect(built.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(built.validation.blocks.groups.every((g) => g.excludedTruth === 0)).toBe(true)
    expect(built.validation.groups.falseConsistent).toBe(0)

    // Removing a record from the query's own group keeps the test honest about what it can tell apart.
    const north = await runSample(ctx, profile, sequenceOf('FM165591.1').slice(0, 900), 'north')
    const statuses = Object.fromEntries(north.result!.findings.map((f) => [f.group, f.status]))
    expect(statuses).toEqual({ n: 'consistent', nw: 'excluded_within_panel', ne: 'excluded_within_panel', s: 'excluded_within_panel' })

    const wrong = await runSample(ctx, profile, parseGenBank(byVersion.get('AY673445.1')!)[0]!.sequence, 'wrong-gene')
    expect(wrong.result).toBeNull()
    expect(wrong.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })
})
