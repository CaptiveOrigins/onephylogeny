import { alignToReference, assessRead, ChromatogramError, joinReads, readAbif, type Alignment, type ReadAssessment } from '@captiveorigins/onephylogeny-core'

/** One opened `.ab1` file: its assessment, or why it couldn't be read. */
export type TraceRead = { name: string; sampleName: string | null; assessment: ReadAssessment } | { name: string; error: string }

/** Reads and judges one chromatogram. A file that isn't a readable ABIF file is reported, never guessed at. */
export function readTrace(name: string, bytes: Uint8Array): TraceRead {
  try {
    const read = readAbif(bytes)
    return { name, sampleName: read.sampleName, assessment: assessRead(read) }
  } catch (e) {
    if (e instanceof ChromatogramError) return { name, error: e.message }
    throw e
  }
}

export type TracePlan =
  | {
      status: 'ready'
      /** What goes to the panel test. */
      sequence: string
      id: string
      /** The files the sequence came from. */
      used: string[]
      /** Set when two reads were joined. */
      join: { conflicts: number; both: number; firstOnly: number; secondOnly: number } | null
      notes: string[]
    }
  | { status: 'refused'; reason: string }

const usable = (r: TraceRead): r is Extract<TraceRead, { assessment: ReadAssessment }> => 'assessment' in r && r.assessment.status === 'usable'
const why = (r: TraceRead) => ('error' in r ? `${r.name} couldn't be read` : r.assessment.status === 'failed' ? `${r.name} failed` : `${r.name} is too short`)
const idOf = (r: Extract<TraceRead, { assessment: ReadAssessment }>) => r.sampleName ?? r.name.replace(/\.(ab1|abi)$/i, '')

/** First and last reference columns an alignment covers, inclusive. */
function span(a: Alignment): { start: number; end: number } {
  const start = a.aligned.search(/[^-]/)
  let end = a.aligned.length - 1
  while (end > start && a.aligned[end] === '-') end--
  return { start, end }
}

/**
 * Decides what, if anything, is tested from one or two reads. Only usable reads are used: a failed or too-short read is
 * never tested. Two usable reads are joined with `joinReads` against the panel reference; a column where two good bases
 * disagree becomes N and is counted. The joined read goes to the test as plain bases: columns neither read covers between
 * them become N, so the two halves keep their places, and gaps inside a read (deletions) are left out.
 */
export function planTraces(reads: readonly TraceRead[], reference: string | null): TracePlan {
  if (!reads.length) return { status: 'refused', reason: 'Open one or two .ab1 files first.' }
  if (reads.length > 2) return { status: 'refused', reason: `Choose one or two .ab1 files, a forward and a reverse read of one sample. ${reads.length} were opened.` }
  const good = reads.filter(usable)
  const left = reads.filter((r) => !usable(r))
  if (!good.length) return { status: 'refused', reason: `Not tested: ${left.map(why).join(' and ')}. A failed or too-short read is never tested.` }
  const leftNote = left.length ? [`${left.map(why).join(' and ')}, so it isn't used. Only ${good[0]!.name} is tested.`] : []
  if (good.length === 1) return { status: 'ready', sequence: good[0]!.assessment.sequence, id: idOf(good[0]!), used: [good[0]!.name], join: null, notes: leftNote }

  const [first, second] = good as [typeof good[0], typeof good[0]]
  if (!reference) return { status: 'refused', reason: 'Joining two reads needs the panel reference, and this panel has none. Build the panel again.' }
  const seen: (Alignment | null)[] = []
  const join = joinReads(first.assessment.sequence, second.assessment.sequence, reference, (seq, ref) => {
    const a = alignToReference(seq, ref)
    seen.push(a)
    return a
  })
  if (join.status === 'refused') return { status: 'refused', reason: `Not tested: neither ${first.name} nor ${second.name} aligns to the panel reference. They may be from another gene or species.` }
  if (join.status === 'single') {
    const [kept, dropped] = seen[0] ? [first, second] : [second, first]
    return { status: 'ready', sequence: kept.assessment.sequence, id: idOf(kept), used: [kept.name], join: null, notes: [`Only ${kept.name} aligns to the panel reference, so ${dropped.name} is left out and ${kept.name} is tested alone.`] }
  }
  const spans = (seen.filter(Boolean) as Alignment[]).map(span)
  const lo = Math.min(...spans.map((s) => s.start))
  const hi = Math.max(...spans.map((s) => s.end))
  let sequence = ''
  for (let i = lo; i <= hi; i++) {
    const c = join.aligned[i]!
    if (c !== '-') sequence += c
    else if (!spans.some((s) => i >= s.start && i <= s.end)) sequence += 'N'
  }
  const notes = [...join.notes]
  const inserted = (seen as Alignment[]).reduce((n, a) => n + a.insertions.reduce((m, x) => m + x.length, 0), 0)
  if (inserted) notes.push(`${inserted} base${inserted === 1 ? '' : 's'} with no column in the reference (insertions) ${inserted === 1 ? 'is' : 'are'} left out of the joined read. Test a read alone to keep them.`)
  return {
    status: 'ready',
    sequence,
    id: idOf(first),
    used: [first.name, second.name],
    join: { conflicts: join.conflicts.length, both: join.columns.both, firstOnly: join.columns.forwardOnly, secondOnly: join.columns.reverseOnly },
    notes,
  }
}
