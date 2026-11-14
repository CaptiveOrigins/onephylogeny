import { buildPanel, evaluateQuery, fullValidation } from '@extantape/onephylogeny-core'
import { EventLog, LineageCard, OutgroupLadderView, PanelSummary, ResultView, ValidationView } from '@extantape/onephylogeny-react'
import { TreeCanvas } from '@extantape/onephylogeny-react/canvas'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * Every OnePhylogeny view, on invented sequences and invented group names: nothing here is a finding about
 * any species. Build with `pnpm --filter @extantape/onephylogeny-playground build`, then open dist/index.html.
 */
const reference = 'ACGT'.repeat(50)
const mutate = (at: number[]) => [...reference].map((c, i) => (at.includes(i) ? (c === 'A' ? 'C' : 'A') : c)).join('')
const window_ = (s: string, from: number, to: number) => [...s].map((c, i) => (i >= from && i < to ? c : '-')).join('')

const settings = {
  id: 'example',
  version: '1.0.0',
  groups: [
    { id: 'north', label: 'Example group North', region: 'Northern example region' },
    { id: 'south', label: 'Example group South', region: 'Southern example region' },
    { id: 'far', label: 'Example group Far' },
  ],
  notCovered: ['Everywhere outside the example regions'],
  validatedScope: [],
  windows: [{ id: 'front', label: 'Front', start: 0, end: 120 }, { id: 'back', label: 'Back', start: 120, end: 200 }],
  controls: { shuffles: 19, simulations: 2 },
  rules: { minSharedColumns: 20, minDepthPerColumn: 1, minBlocksForExclusion: 1, minDecisiveSites: 2, tolerance: 1 },
}
const members = [
  { record: 'N1', group: 'north', aligned: mutate([5, 50, 90]), provenanceClass: 'wild-documented' as const, block: 'site-1' },
  { record: 'N2', group: 'north', aligned: mutate([5, 50, 90, 120]), provenanceClass: 'wild-documented' as const, block: 'site-2' },
  { record: 'S1', group: 'south', aligned: mutate([6, 51, 91]), provenanceClass: 'wild-documented' as const, block: 'site-3' },
  { record: 'S2', group: 'south', aligned: mutate([6, 51, 91, 130]), provenanceClass: 'seized' as const, block: 'site-4' },
  { record: 'F1', group: 'far', aligned: window_(mutate([150, 160]), 120, 200), provenanceClass: 'wild-documented' as const, block: 'site-5' },
]
const input = { settings, taxa: [{ source: 'example', id: '1' }], marker: { kind: 'gene' as const, gene: 'example' }, reference: { accession: 'EXAMPLE.1', length: 200 }, sources: [], builtBy: 'playground', members }
const { panel, sequences } = buildPanel(input)
const query = window_(mutate([5, 50, 90]), 0, 110)
const result = evaluateQuery(query, { panel, sequences }, { queryId: 'example-sample', runId: 'playground' })
const newick = '((N1:0.002,N2:0.003)92.4/97:0.02,(S1:0.002,S2:0.004)71.0/88:0.018,F1:0.05);'
const events = [
  { at: '2026-01-01T00:00:00.000Z', level: 'info' as const, step: 'fetch', message: 'Downloaded 5 example records' },
  { at: '2026-01-01T00:00:01.000Z', level: 'warning' as const, step: 'gate', message: 'One record covers part of the reference' },
]

const tabs = {
  Result: () => <ResultView result={result} panel={panel} queryAligned={query} />,
  'Lineage card': () => <LineageCard result={result} panel={panel} marker="example gene" />,
  Panel: () => <PanelSummary panel={panel} />,
  Validation: () => <ValidationView {...fullValidation(input)} panel={panel} />,
  Tree: () => <TreeCanvas newick={newick} thresholds={[80, 95]} height="24rem" />,
  Outgroups: () => (
    <OutgroupLadderView
      suggested="Example family"
      caveat="Illustrative counts. Closer isn't always better: check where each candidate falls on the tree."
      steps={[
        { taxon: { name: 'Example genus', rank: 'genus' }, records: 1, species: ['Example one'], sufficient: false },
        { taxon: { name: 'Example family', rank: 'family' }, records: 14, species: ['Example two', 'Example three'], sufficient: true },
      ]}
    />
  ),
  'Run log': () => <EventLog events={events} />,
}
type Tab = keyof typeof tabs

function App() {
  const [tab, setTab] = useState<Tab>('Result')
  const View = tabs[tab]
  return (
    <>
      <h1>OnePhylogeny playground</h1>
      <p>Invented data only. Nothing here is a finding about any species.</p>
      <nav aria-label="Views">
        {(Object.keys(tabs) as Tab[]).map((t) => (
          <button key={t} type="button" aria-pressed={t === tab} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <View />
    </>
  )
}

createRoot(document.getElementById('app')!).render(<App />)
