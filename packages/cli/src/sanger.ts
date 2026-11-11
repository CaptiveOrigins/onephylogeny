import { alignToReference, joinReads, type Alignment, type ReadAssessment } from '@captiveorigins/onephylogeny-core'

/** One assessed read, as the CLI holds it: the file it came from and what `assessRead` said. */
export type AssessedRead = { file: string; sampleName: string | null; assessment: ReadAssessment }

export type ReadPair =
  | {
      status: 'joined'
      /** The joined read as plain bases, ready for `test`: reference gaps removed. */
      sequence: string
      /** Reference columns the joined read spans, counting from 1, inclusive. */
      span: { start: number; end: number }
      /** Reference columns, counting from 1, where both reads had a good base and they disagreed: written as N. */
      conflicts: number[]
      columns: { both: number; forwardOnly: number; reverseOnly: number }
      used: string[]
      notes: string[]
    }
  | { status: 'single'; sequence: string; used: string[]; notes: string[] }
  | { status: 'refused'; reason: string }

const usable = (r: AssessedRead) => r.assessment.status === 'usable'
const why = (r: AssessedRead) => `${r.file} ${r.assessment.status === 'failed' ? 'failed' : 'is too short'}`

/** First and last reference columns an alignment covers, 0-based, inclusive. */
function span(a: Alignment): { start: number; end: number } {
  const start = a.aligned.search(/[^-]/)
  let end = a.aligned.length - 1
  while (end > start && a.aligned[end] === '-') end--
  return { start, end }
}

/**
 * What `sanger --reverse` prints, decided from two assessed reads and the panel's reference. Only usable reads are used.
 * Two usable reads are joined with `joinReads` (aligned with `alignToReference`, which turns the reverse read); a column
 * where two good bases disagree is N and listed, never chosen. The joined read is then written as plain bases: columns
 * neither read covers between them become N, so both halves keep their places, and gaps inside a read (deletions) and
 * bases the reference has no column for (insertions) are left out, with a note saying how many. One unusable read, or
 * one that doesn't align, means the other is used alone, and that's said. Neither usable, or neither aligning, is a refusal.
 */
export function joinPair(forward: AssessedRead, reverse: AssessedRead, reference: string): ReadPair {
  const good = [forward, reverse].filter(usable)
  if (!good.length) return { status: 'refused', reason: `Neither read can be used: ${why(forward)} and ${why(reverse)}. A failed or too-short read is never used.` }
  if (good.length === 1) {
    const [kept, dropped] = usable(forward) ? [forward, reverse] : [reverse, forward]
    return { status: 'single', sequence: kept.assessment.sequence, used: [kept.file], notes: [`${why(dropped)}, so only ${kept.file} is used, alone and not joined.`] }
  }
  const seen = new Map<'forward' | 'reverse', Alignment | null>()
  let next: 'forward' | 'reverse' = 'forward'
  const join = joinReads(forward.assessment.sequence, reverse.assessment.sequence, reference, (seq, ref) => {
    const a = alignToReference(seq, ref)
    seen.set(next, a)
    next = 'reverse'
    return a
  })
  if (join.status === 'refused') return { status: 'refused', reason: `Neither ${forward.file} nor ${reverse.file} aligns to the panel's reference. They may be from another gene or species.` }
  if (join.status === 'single') {
    const [kept, dropped] = seen.get('forward') ? [forward, reverse] : [reverse, forward]
    return { status: 'single', sequence: kept.assessment.sequence, used: [kept.file], notes: [`Only ${kept.file} aligns to the panel's reference, so ${dropped.file} is left out and ${kept.file} is used alone.`] }
  }
  const alignments = [...seen.values()] as Alignment[]
  const spans = alignments.map(span)
  const lo = Math.min(...spans.map((s) => s.start))
  const hi = Math.max(...spans.map((s) => s.end))
  let sequence = ''
  let deleted = 0
  let filled = 0
  for (let i = lo; i <= hi; i++) {
    const c = join.aligned[i]!
    if (c !== '-') sequence += c
    else if (spans.some((s) => i >= s.start && i <= s.end)) deleted++
    else {
      sequence += 'N'
      filled++
    }
  }
  const notes = [...join.notes]
  if (filled) notes.push(`The reads don't meet: ${filled} reference column${filled === 1 ? '' : 's'} between them ${filled === 1 ? 'is' : 'are'} written as N, so both keep their places.`)
  if (deleted) notes.push(`${deleted} reference column${deleted === 1 ? '' : 's'} where the reads have a gap (a deletion) ${deleted === 1 ? 'is' : 'are'} left out of the FASTA.`)
  const inserted = alignments.reduce((n, a) => n + a.insertions.reduce((m, x) => m + x.length, 0), 0)
  if (inserted) notes.push(`${inserted} base${inserted === 1 ? '' : 's'} with no column in the reference (insertions) ${inserted === 1 ? 'is' : 'are'} left out of the joined read. Use a read alone to keep them.`)
  return {
    status: 'joined',
    sequence,
    span: { start: lo + 1, end: hi + 1 },
    conflicts: join.conflicts.map((c) => c + 1),
    columns: join.columns,
    used: [forward.file, reverse.file],
    notes,
  }
}
