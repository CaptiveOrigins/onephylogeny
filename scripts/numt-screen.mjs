#!/usr/bin/env node
/**
 * NUMT screen: looks for nuclear copies of a mitochondrial marker in a related genome, then asks
 * whether any record is closer to one of those copies than to the species' mitochondrial reference.
 *
 * Method and flag rule: docs/architecture/analysis-protocol.md, section 7. A flag sends a record to
 * review. No outcome clears a record, because a copy that arose after the two species split can't be
 * in this genome. Needs BLAST+ on the PATH. Runs outside the app, once per species.
 *
 *   node scripts/numt-screen.mjs --genome nuclear-and-organelle.fna --mitogenome mito.fasta \
 *     --reference reference.fasta --aligned aligned.fasta --out dir [--exclude NC_1,NC_2] [--threads 8]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'

/** Fixed before the first real run. Changing one needs a deviation-log entry. */
export const RULES = {
  blastEvalue: 0.001,
  strictBlastEvalue: 1e-10,
  strictProteinEvalue: 1e-6,
  minHitNucleotides: 30,
  minHitAminoAcids: 10,
  proteinMatrix: 'PAM70',
  proteinGeneticCode: 2,
  minSharedColumns: 100,
  shortRecord: 313,
  mitoLikeMaxScaffold: 20000,
  mitoLikeMinCoverage: 0.5,
}

const FIELDS = 'qseqid qlen sseqid slen pident length qstart qend sstart send evalue bitscore sseq qseq'
const OUTFMT = `6 ${FIELDS}`
const MAX_BUFFER = 2 ** 31 - 1

const run = (cmd, args, input) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, input, stdio: ['pipe', 'pipe', 'pipe'] })

export function parseFasta(text) {
  const out = []
  for (const block of text.split(/^>/m).slice(1)) {
    const nl = block.indexOf('\n')
    out.push({ id: block.slice(0, nl).trim().split(/\s+/)[0], seq: block.slice(nl + 1).replace(/\s+/g, '').toUpperCase() })
  }
  return out
}

/** Vertebrate mitochondrial translation (NCBI table 2). A trailing partial codon is dropped. */
export function translateMito(seq) {
  const bases = 'TCAG'
  const aa = 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG'
  let out = ''
  for (let i = 0; i + 3 <= seq.length; i += 3) {
    const [a, b, c] = [...seq.slice(i, i + 3)].map((x) => bases.indexOf(x))
    out += a < 0 || b < 0 || c < 0 ? 'X' : aa[a * 16 + b * 4 + c]
  }
  return out.replace(/\*+$/, '')
}

export function parseHits(text, source) {
  return text.split('\n').filter(Boolean).map((line) => {
    const f = line.split('\t')
    const [sa, sb] = [Number(f[8]), Number(f[9])]
    return {
      source,
      query: f[0],
      qlen: Number(f[1]),
      subject: f[2],
      slen: Number(f[3]),
      pident: Number(f[4]),
      length: Number(f[5]),
      qstart: Number(f[6]),
      qend: Number(f[7]),
      sfrom: Math.min(sa, sb),
      sto: Math.max(sa, sb),
      evalue: Number(f[10]),
      bitscore: Number(f[11]),
      sseq: f[12],
      qseq: f[13],
    }
  })
}

/** Merges overlapping intervals per subject. Returns loci sorted by subject and start. */
export function mergeIntervals(hits) {
  const bySubject = new Map()
  for (const h of hits) (bySubject.get(h.subject) ?? bySubject.set(h.subject, []).get(h.subject)).push(h)
  const loci = []
  for (const [subject, list] of [...bySubject].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.sfrom - b.sfrom)
    let cur
    for (const h of list) {
      if (cur && h.sfrom <= cur.to) {
        cur.to = Math.max(cur.to, h.sto)
        cur.hits.push(h)
      } else {
        cur = { subject, slen: h.slen, from: h.sfrom, to: h.sto, hits: [h] }
        loci.push(cur)
      }
    }
  }
  return loci
}

/**
 * Projects one BLAST alignment onto query columns, filling only empty columns. Insertions in the
 * subject have no reference column and are dropped; deletions stay as gaps.
 */
export function projectHsp(columns, hit) {
  const forward = hit.qstart <= hit.qend
  let q = hit.qstart - 1
  for (let i = 0; i < hit.qseq.length; i++) {
    const qc = hit.qseq[i]
    if (qc === '-') continue
    if (columns[q] === '-' && hit.sseq[i] !== '-') columns[q] = hit.sseq[i]
    q += forward ? 1 : -1
  }
}

/** Mismatches over columns where both sequences have an unambiguous base. */
export function compare(a, b) {
  let shared = 0
  let diff = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (!'ACGT'.includes(a[i]) || !'ACGT'.includes(b[i])) continue
    shared++
    if (a[i] !== b[i]) diff++
  }
  return { shared, diff, distance: shared ? diff / shared : null }
}

/** Keeps only columns that hold a base in `mask`. */
const within = (seq, mask) => [...seq].map((c, i) => ('ACGT'.includes(mask[i]) ? c : '-')).join('')

/**
 * The flag rule. Distances to the copy and to the reference use the same columns, so neither is
 * favored by coverage. Ties don't flag: a record equally close to both has shown nothing either way.
 */
export function assessRecord(record, locusColumns, reference, rules = RULES) {
  const shared = compare(record, locusColumns)
  if (shared.shared < rules.minSharedColumns) return null
  const ref = compare(within(record, locusColumns), reference)
  return { shared: shared.shared, toCopy: shared.distance, toReference: ref.distance, flagged: shared.distance < ref.distance }
}

/** A scaffold mostly made of mitochondrial hits and no longer than a mitogenome or two. */
export function isMitoLike(locusList, slen, rules = RULES) {
  const covered = locusList.reduce((sum, l) => sum + (l.to - l.from + 1), 0)
  return slen <= rules.mitoLikeMaxScaffold && covered / slen >= rules.mitoLikeMinCoverage
}

async function writeNuclear(genome, exclude, path) {
  const out = createWriteStream(path)
  const found = new Set()
  let keep = true
  let sequences = 0
  for await (const line of createInterface({ input: createReadStream(genome) })) {
    if (line.startsWith('>')) {
      const id = line.slice(1).split(/\s+/)[0]
      keep = !exclude.includes(id)
      if (keep) sequences++
      else found.add(id)
    }
    if (keep && !out.write(line + '\n')) await new Promise((r) => out.once('drain', r))
  }
  await new Promise((r) => out.end(r))
  return { sequences, excluded: [...found] }
}

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256')
  createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(`sha256:${h.digest('hex')}`)).on('error', reject)
})

const passes = (h) => h.evalue < RULES.blastEvalue && h.length >= (h.source === 'protein' ? RULES.minHitAminoAcids : RULES.minHitNucleotides)
const passesStrict = (h) => h.evalue < (h.source === 'protein' ? RULES.strictProteinEvalue : RULES.strictBlastEvalue)

async function main() {
  const { values: a } = parseArgs({
    options: {
      genome: { type: 'string' }, mitogenome: { type: 'string' }, reference: { type: 'string' }, aligned: { type: 'string' },
      out: { type: 'string' }, exclude: { type: 'string', default: '' }, threads: { type: 'string', default: '8' },
    },
  })
  for (const k of ['genome', 'mitogenome', 'reference', 'aligned', 'out']) if (!a[k]) throw new Error(`Missing --${k}`)
  mkdirSync(a.out, { recursive: true })
  const p = (name) => join(a.out, name)
  const threads = a.threads

  const exclude = a.exclude.split(',').filter(Boolean)
  const nuclear = p('nuclear.fna')
  let db = { sequences: null, excluded: [] }
  if (!existsSync(`${nuclear}.ndb`)) {
    db = await writeNuclear(a.genome, exclude, nuclear)
    run('makeblastdb', ['-in', nuclear, '-dbtype', 'nucl', '-parse_seqids', '-out', nuclear])
  }

  const reference = parseFasta(readFileSync(a.reference, 'utf8'))[0]
  const mitogenome = parseFasta(readFileSync(a.mitogenome, 'utf8'))[0]
  const records = parseFasta(readFileSync(a.aligned, 'utf8'))
  const cytbAt = mitogenome.seq.indexOf(reference.seq)
  if (cytbAt < 0) throw new Error('The reference marker was not found in the mitogenome, so hits can\'t be located on it.')

  writeFileSync(p('marker.protein.fasta'), `>${reference.id}.protein\n${translateMito(reference.seq)}\n`)
  writeFileSync(p('records.fasta'), records.map((r) => `>${r.id}\n${r.seq.replace(/-/g, '')}\n`).join(''))

  const blast = (query, outName, source, extra = []) => {
    const file = p(outName)
    if (!existsSync(file)) {
      const tool = source === 'protein' ? 'tblastn' : 'blastn'
      const args = ['-query', query, '-db', nuclear, '-evalue', String(RULES.blastEvalue), '-outfmt', OUTFMT, '-num_threads', threads, '-max_target_seqs', '5000', ...extra]
      writeFileSync(file, run(tool, tool === 'blastn' ? ['-task', 'blastn', ...args] : args))
    }
    return parseHits(readFileSync(file, 'utf8'), source)
  }

  const mitoHits = blast(a.mitogenome, 'hits.mitogenome.tsv', 'mitogenome')
  const markerHits = blast(a.reference, 'hits.marker.tsv', 'marker')
  const proteinHits = blast(p('marker.protein.fasta'), 'hits.protein.tsv', 'protein', ['-db_gencode', String(RULES.proteinGeneticCode), '-matrix', RULES.proteinMatrix])
  const recordHits = blast(p('records.fasta'), 'hits.records.tsv', 'records')

  // Scaffolds that look like the organelle itself are reported apart: they say nothing about nuclear copies.
  const mitoLocusList = mergeIntervals(mitoHits.filter(passes))
  const mitoLike = new Set()
  for (const subject of new Set(mitoLocusList.map((l) => l.subject))) {
    const list = mitoLocusList.filter((l) => l.subject === subject)
    if (isMitoLike(list, list[0].slen)) mitoLike.add(subject)
  }

  const end = cytbAt + reference.seq.length
  const mitoOverMarker = mitoHits.filter((h) => Math.max(h.qstart, h.qend) > cytbAt && Math.min(h.qstart, h.qend) <= end)
  const all = [...markerHits, ...proteinHits, ...recordHits, ...mitoOverMarker].filter(passes)
  const loci = mergeIntervals(all.filter((h) => !mitoLike.has(h.subject)))

  // Each locus is placed on reference columns by aligning the reference to it.
  const library = []
  const unplaced = []
  loci.forEach((locus, i) => {
    const seq = run('blastdbcmd', ['-db', nuclear, '-entry', locus.subject, '-range', `${locus.from}-${locus.to}`, '-outfmt', '%s']).replace(/\s+/g, '').toUpperCase()
    const name = `locus${String(i + 1).padStart(4, '0')}`
    const tmp = p(`${name}.tmp.fasta`)
    writeFileSync(tmp, `>${name}\n${seq}\n`)
    const placed = parseHits(run('blastn', ['-task', 'blastn', '-query', a.reference, '-subject', tmp, '-evalue', String(RULES.blastEvalue), '-outfmt', OUTFMT]), 'place')
    execFileSync('rm', ['-f', tmp])
    const entry = {
      name, subject: locus.subject, slen: locus.slen, from: locus.from, to: locus.to,
      sources: [...new Set(locus.hits.map((h) => h.source))].sort(),
      bestEvalue: Math.min(...locus.hits.map((h) => h.evalue)),
      strict: locus.hits.some(passesStrict),
    }
    if (!placed.length) {
      unplaced.push(entry)
      return
    }
    const columns = Array(reference.seq.length).fill('-')
    for (const h of placed.sort((x, y) => y.bitscore - x.bitscore)) projectHsp(columns, h)
    const aligned = columns.join('')
    const toRef = compare(aligned, reference.seq)
    library.push({ ...entry, aligned, columns: toRef.shared, toReference: toRef.distance })
  })

  const rows = records.map((r) => {
    const length = r.seq.replace(/-/g, '').length
    const tests = library.map((l) => ({ l, t: assessRecord(r.seq, l.aligned, reference.seq) })).filter((x) => x.t)
    const flagged = tests.filter((x) => x.t.flagged)
    const margin = (x) => x.t.toCopy - x.t.toReference
    const worst = [...tests].sort((x, y) => margin(x) - margin(y))[0]
    const others = records.filter((o) => o.id !== r.id)
    const nearest = flagged.length
      ? Math.min(...others.map((o) => compare(within(r.seq, worst.l.aligned), o.seq)).filter((c) => c.shared >= RULES.minSharedColumns).map((c) => c.distance))
      : null
    return {
      accession: r.id,
      length,
      status: flagged.length ? 'flagged-for-review' : tests.length ? 'no-signal' : 'not-assessed',
      short: length < RULES.shortRecord,
      lociTested: tests.length,
      lociFlagged: flagged.length,
      closestLocus: worst?.l.name ?? '',
      sharedColumns: worst?.t.shared ?? '',
      toCopy: worst?.t.toCopy ?? '',
      toReference: worst?.t.toReference ?? '',
      nearestOtherRecord: nearest ?? '',
    }
  })

  const tsv = (list) => {
    const keys = Object.keys(list[0] ?? {})
    return [keys.join('\t'), ...list.map((o) => keys.map((k) => o[k]).join('\t'))].join('\n') + '\n'
  }
  writeFileSync(p('records.tsv'), tsv(rows))
  writeFileSync(p('loci.tsv'), tsv(library.map(({ aligned, ...l }) => ({ ...l, sources: l.sources.join(',') }))))
  writeFileSync(p('numt-library.fasta'), library.map((l) => `>${l.name} ${l.subject}:${l.from}-${l.to}\n${l.aligned}\n`).join(''))

  const distances = library.filter((l) => l.columns >= RULES.minSharedColumns).map((l) => l.toReference).sort((x, y) => x - y)
  const counts = (key) => rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + 1 }), {})
  const summary = {
    rules: RULES,
    tools: { blast: run('blastn', ['-version']).split('\n')[0] },
    inputs: { genome: await sha256(a.genome), mitogenome: await sha256(a.mitogenome), reference: await sha256(a.reference), aligned: await sha256(a.aligned) },
    excludedFromDatabase: exclude,
    database: db,
    mitochondrionLikeScaffolds: [...mitoLike],
    hitsPassing: { mitogenomeAnywhere: mitoHits.filter(passes).length, marker: markerHits.filter(passes).length, protein: proteinHits.filter(passes).length, records: recordHits.filter(passes).length },
    loci: { total: loci.length, placed: library.length, unplaced: unplaced.map((u) => `${u.subject}:${u.from}-${u.to}`), strict: library.filter((l) => l.strict).length, testable: distances.length },
    copyDistanceToReference: distances.length ? { closest: distances[0], median: distances[Math.floor(distances.length / 2)], furthest: distances.at(-1) } : null,
    records: { total: rows.length, status: counts('status'), short: rows.filter((r) => r.short).length, flagged: rows.filter((r) => r.status === 'flagged-for-review').map((r) => r.accession) },
  }
  writeFileSync(p('summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
