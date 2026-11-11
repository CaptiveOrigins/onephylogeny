import { useState } from 'react'
import type { Platform } from './platform'
import { planTraces, readTrace, type TracePlan, type TraceRead } from './trace-plan'

const STATUS = { usable: 'Usable', short: 'Too short to use', failed: 'Failed' } as const

function ReadCard({ read }: { read: TraceRead }) {
  if ('error' in read) return <article className="trace" aria-label={`Read ${read.name}`}><h4>{read.name}</h4><p className="error">Couldn't read this file: {read.error}</p><p className="muted">It isn't tested.</p></article>
  const a = read.assessment
  const kept = a.kept ? a.kept.end - a.kept.start : 0
  return (
    <article className="trace" aria-label={`Read ${read.name}`}>
      <h4>{read.name}</h4>
      <dl className="trace-facts">
        <dt>Status</dt><dd>{STATUS[a.status]}</dd>
        <dt>Bases kept</dt><dd>{a.kept ? `${kept} of ${a.rawLength} (bases ${a.kept.start + 1} to ${a.kept.end})` : `None of ${a.rawLength}`}</dd>
        <dt>Mean quality</dt><dd>{a.meanQuality == null ? 'Not recorded in the file' : `Q${a.meanQuality}`}</dd>
        <dt>Masked as N</dt><dd>{a.maskedBases}</dd>
        <dt>Mixed peaks</dt><dd>{a.mixedPeaks == null ? 'Not checked: the file has no traces' : a.mixedPeaks.length}</dd>
        {read.sampleName && <><dt>Sample name in the file</dt><dd>{read.sampleName}</dd></>}
      </dl>
      <ul className="plain">{a.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </article>
  )
}

function PlanText({ plan }: { plan: TracePlan }) {
  if (plan.status === 'refused') return <p className="error">{plan.reason}</p>
  return <>
    {plan.join
      ? <p>Joined {plan.used.join(' and ')}: {plan.join.both} columns from both, {plan.join.firstOnly} from the first only, {plan.join.secondOnly} from the second only. Conflicts: {plan.join.conflicts} ({plan.join.conflicts === 1 ? 'a column' : 'columns'} where good bases disagree, written as N).</p>
      : <p>Using {plan.used[0]} alone.</p>}
    {plan.notes.map((n) => <p key={n} className="muted">{n}</p>)}
    <p>Tested as {plan.id}, {plan.sequence.length} bases.</p>
  </>
}

/**
 * Sanger chromatograms as a sample (roadmap stage 6.3): one read, or a forward and a reverse read joined against the
 * panel reference. Each read's assessment is shown before anything is tested, and a failed or too-short read is never
 * tested. `onTest` runs the ordinary panel test with the resulting sequence.
 */
export function TraceInput({ platform, hasPanel, attempt, reference, onTest }: {
  platform: Platform
  hasPanel: boolean
  attempt: (label: string, work: () => Promise<void>) => Promise<void>
  /** The panel reference, needed only to join two reads. */
  reference: () => Promise<string | null>
  onTest: (sequence: string, id: string) => Promise<void>
}) {
  const [reads, setReads] = useState<TraceRead[]>([])
  const [plan, setPlan] = useState<TracePlan | null>(null)
  if (!platform.openChromatograms) return null
  const open = () => attempt('Opening', async () => {
    const files = await platform.openChromatograms!()
    if (!files) return
    setPlan(null)
    if (files.length > 2) {
      setReads([])
      setPlan({ status: 'refused', reason: `Choose one or two .ab1 files, a forward and a reverse read of one sample. ${files.length} were chosen.` })
      return
    }
    setReads(files.map((f) => readTrace(f.name, f.bytes)))
  })
  const test = () => attempt('Testing', async () => {
    const usable = reads.filter((r) => 'assessment' in r && r.assessment.status === 'usable').length
    const next = planTraces(reads, usable === 2 ? await reference() : null)
    setPlan(next)
    if (next.status === 'ready') await onTest(next.sequence, next.id)
  })
  return (
    <section className="traces" aria-labelledby="traces-heading">
      <h3 id="traces-heading">Or test chromatograms (.ab1)</h3>
      <p className="muted">One read, or a forward and a reverse read of the same sample. Each read is trimmed by quality and its weak bases become N. A failed or too-short read is never tested. Two reads are joined against the panel reference, and where they disagree the base becomes N.</p>
      <div className="actions">
        <button onClick={open}>Open .ab1 files</button>
        {reads.length > 0 && <button onClick={() => { setReads([]); setPlan(null) }}>Clear reads</button>}
        <button className="primary" disabled={!hasPanel || !reads.length} onClick={test}>Test reads against panel</button>
      </div>
      {reads.map((r, i) => <ReadCard key={`${i}:${r.name}`} read={r} />)}
      <div role="status" aria-label="Chromatogram outcome" className="trace-plan">{plan && <PlanText plan={plan} />}</div>
    </section>
  )
}
