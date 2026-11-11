#!/usr/bin/env node
// Writes fixtures/golden/mitogenome.gb: a small, made-up "mitogenome" panel for the engine's end-to-end test (ADR 0009).
// Nothing here is real: random bases from a fixed seed, made-up accessions, no places. Run it again to get the same file.
//
//   node scripts/mitogenome-fixture.mjs
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'fixtures', 'golden', 'mitogenome.gb')

// mulberry32: small and seeded, so the fixture is the same on every machine.
let seed = 20261111
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const BASES = 'ACGT'
const base = () => BASES[Math.floor(random() * 4)]
const bases = (n) => Array.from({ length: n }, base).join('')
// Stops in the vertebrate mitochondrial code (2): TAA, TAG, AGA, AGG. TGA reads as Trp.
const STOPS = new Set(['TAA', 'TAG', 'AGA', 'AGG'])
const senseCodon = () => { for (;;) { const c = bases(3); if (!STOPS.has(c)) return c } }
const cds = (codons) => `ATG${Array.from({ length: codons - 2 }, senseCodon).join('')}TAA`
const rc = (s) => [...s].reverse().map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[c]).join('')

// Layout, 1-based inclusive like GenBank. One gene on the minus strand (ND6), and a control region at the end.
const trnF = bases(66) // 1..66
const rrnS = bases(240) // 67..306
const cox1 = cds(119) // 307..663
const trnS = bases(66) // 664..729
const nd6 = cds(100) // complement(730..1029)
const cytb = cds(103) // 1030..1338
const dloop = bases(162) // 1339..1500
const reference = trnF + rrnS + cox1 + trnS + rc(nd6) + cytb + dloop
if (reference.length !== 1500) throw new Error(`reference is ${reference.length} bp`)

const features = [
  ['tRNA', '1..66', { gene: 'trnF', product: 'tRNA-Phe' }],
  ['rRNA', '67..306', { gene: 'rrnS', product: '12S ribosomal RNA' }],
  ['CDS', '307..663', { gene: 'COX1', product: 'cytochrome c oxidase subunit I', transl_table: '2' }],
  ['tRNA', '664..729', { gene: 'trnS', product: 'tRNA-Ser' }],
  ['CDS', 'complement(730..1029)', { gene: 'ND6', product: 'NADH dehydrogenase subunit 6', transl_table: '2' }],
  ['CDS', '1030..1338', { gene: 'CYTB', product: 'cytochrome b', transl_table: '2' }],
  ['D-loop', '1339..1500', {}],
]

// Changes that keep every codon a sense codon, so only the record made with a frameshift is flagged.
const swap = { A: 'G', G: 'A', C: 'T', T: 'C' }
const codonSafe = (seq, at) => {
  const next = seq.slice(0, at) + swap[seq[at]] + seq.slice(at + 1)
  const genes = [[306, 663, '+'], [729, 1029, '-'], [1029, 1338, '+']]
  for (const [s, e, strand] of genes) {
    if (at < s || at >= e) continue
    const gene = strand === '+' ? next.slice(s, e) : rc(next.slice(s, e))
    for (let i = 3; i < gene.length - 3; i += 3) if (STOPS.has(gene.slice(i, i + 3))) return null
  }
  return next
}
const mutate = (seq, positions) => positions.reduce((s, at) => {
  for (let d = 0; d < 3; d++) { const next = codonSafe(s, at + d); if (next) return next }
  throw new Error(`no safe change near ${at}`)
}, seq)

// Fixed differences between the groups, in rrnS, COX1, ND6 and CYTB. None in the first 220 bases, where rotation anchors.
const south = mutate(reference, [230, 262, 290, 400, 475, 562, 800, 905, 1100, 1180, 1270])
const north = reference
const turn = (seq, by) => seq.slice(by) + seq.slice(0, by)
const insert = (seq, at, extra) => seq.slice(0, at) + extra + seq.slice(at)
const remove = (seq, at) => seq.slice(0, at) + seq.slice(at + 1)

const records = [
  { id: 'ZZ900000.1', note: 'the made-up reference', seq: reference, annotated: true },
  { id: 'ZZ900001.1', note: 'north, starts where the reference starts', seq: mutate(north, [700]) },
  { id: 'ZZ900002.1', note: 'north, turned by 500', seq: turn(mutate(north, [1300]), 500) },
  { id: 'ZZ900003.1', note: 'north, turned by 1100 and stored on the other strand', seq: rc(turn(mutate(north, [450]), 1100)) },
  { id: 'ZZ900004.1', note: 'north, turned by 300, with 4 extra bases in the control region', seq: turn(insert(mutate(north, [960]), 1400, 'ACAC'), 300) },
  { id: 'ZZ900005.1', note: 'south, turned by 700', seq: turn(mutate(south, [330]), 700) },
  { id: 'ZZ900006.1', note: 'south, turned by 50 and stored on the other strand', seq: rc(turn(mutate(south, [1060]), 50)) },
  { id: 'ZZ900007.1', note: 'south, turned by 1300', seq: turn(mutate(south, [620]), 1300) },
  { id: 'ZZ900008.1', note: 'south, turned by 900, with one base of COX1 missing (a frameshift)', seq: turn(remove(mutate(south, [1240]), 520), 900) },
  { id: 'ZZ900009.1', note: 'a partial, linear record holding only CYTB and around it', seq: north.slice(1000, 1400), linear: true },
  { id: 'ZZ900010.1', note: 'circular and complete-length, but unrelated, so it can\'t be turned', seq: bases(1500) },
]

const wrap = (text, first, indent) => {
  const words = text.split(' ')
  const lines = []
  let line = first
  for (const w of words) {
    if (line.length + w.length + 1 > 79 && line.trim().length > first.trim().length) { lines.push(line); line = indent }
    line += (line.endsWith(' ') ? '' : ' ') + w
  }
  lines.push(line)
  return lines.join('\n')
}
const origin = (seq) => {
  const lines = []
  for (let i = 0; i < seq.length; i += 60) {
    const chunk = seq.slice(i, i + 60).toLowerCase().match(/.{1,10}/g).join(' ')
    lines.push(`${String(i + 1).padStart(9)} ${chunk}`)
  }
  return lines.join('\n')
}
const feature = ([key, location, q]) => [
  `     ${key.padEnd(16)}${location}`,
  ...Object.entries(q).map(([k, v]) => `                     /${k}=${/^\d+$/.test(v) ? v : `"${v}"`}`),
].join('\n')

const block = (r) => {
  const accession = r.id.split('.')[0]
  return [
    `LOCUS       ${accession.padEnd(16)}${String(r.seq.length).padStart(5)} bp    DNA     ${r.linear ? 'linear  ' : 'circular'} VRT 11-NOV-2026`,
    wrap(`Made-up test mitogenome (${r.note}). Not a real organism or record.`, 'DEFINITION  ', '            '),
    `ACCESSION   ${accession}`,
    `VERSION     ${r.id}`,
    'SOURCE      mitochondrion Fictional testudine',
    '  ORGANISM  Fictional testudine',
    '            Testudines; Made-up.',
    `REFERENCE   1  (bases 1 to ${r.seq.length})`,
    '  AUTHORS   OnePhylogeny fixtures.',
    '  TITLE     Made-up mitogenomes for an engine test',
    '  JOURNAL   Unpublished',
    'FEATURES             Location/Qualifiers',
    `     source          1..${r.seq.length}`,
    '                     /organism="Fictional testudine"',
    '                     /organelle="mitochondrion"',
    '                     /mol_type="genomic DNA"',
    ...(r.annotated ? features.map(feature) : []),
    'ORIGIN',
    origin(r.seq),
    '//',
  ].join('\n')
}

writeFileSync(out, `${records.map(block).join('\n')}\n`)
console.log(`Wrote ${path.relative(root, out)}: ${records.length} records`)
