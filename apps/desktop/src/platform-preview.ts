import type { Platform } from './platform'

/** A synthetic reference and records, so the interface can be seen without a Mac app or real data. */
function randomSeq(n: number, seed: number): string {
  let a = seed >>> 0
  let out = ''
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out += 'ACGT'[((t ^ (t >>> 14)) >>> 0) % 4]
  }
  return out
}
const REF = randomSeq(900, 1)
const mut = (at: number[]) => [...REF].map((c, i) => (at.includes(i) ? (c === 'A' ? 'C' : 'A') : c)).join('')
const gb = (acc: string, seq: string, org: string, loc: string, title: string) =>
  `LOCUS       ${acc}  ${seq.length} bp DNA\nDEFINITION  ${org} gene x.\nACCESSION   ${acc}\nVERSION     ${acc}.1\nSOURCE      ${org}\n  ORGANISM  ${org}\n            Life; Example.\nREFERENCE   1\n  AUTHORS   Author,A.\n  TITLE     ${title}\n  JOURNAL   Example Journal 1 (2020)\nFEATURES             Location/Qualifiers\n     source          1..${seq.length}\n                     /organism="${org}"\n                     /db_xref="taxon:1"\n                     /geo_loc_name="${loc}"\nORIGIN\n        1 ${seq.toLowerCase()}\n//\n`
const northern = [30, 200, 410, 620, 700]
const southern = [33, 203, 413, 623, 703]
const DB: Record<string, string> = { 'REF1.1': gb('REF1', REF, 'Example taxon', 'Nowhere', 'Reference genome') }
for (let i = 0; i < 12; i++) DB[`N${i}.1`] = gb(`N${i}`, mut([...northern, 300 + i]), 'Example taxon', 'Northland', 'A study of the north')
for (let i = 0; i < 9; i++) DB[`S${i}.1`] = gb(`S${i}`, mut([...southern, 500 + i]).slice(0, i < 4 ? 500 : 900), 'Example taxon', 'Southland', 'A study of the south')
for (const [n, seed] of [[91, 40], [92, 60], [93, 80]] as const) DB[`OUT${n}.1`] = gb(`OUT${n}`, mut(Array.from({ length: seed }, (_, i) => 7 + i * 11)), 'Example outgroup', 'Elsewhere', 'An outgroup study')
DB['X1.1'] = gb('X1', randomSeq(700, 77), 'Example taxon', 'Unknown', 'A different gene')

export const PREVIEW_SAMPLE = `>north-sample\n${mut([...northern, 333]).slice(0, 800)}\n>short-fragment\n${mut(northern).slice(600, 880)}\n>unlike-anything\n${mut(Array.from({ length: 70 }, (_, i) => i * 12))}\n`

export function createPreviewPlatform(): Platform {
  const files = new Map<string, string>()
  const seen = (dir: string) => [...new Set([...files.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1).split('/')[0]!))].sort()
  const respond = (text: string) => ({ ok: true, status: 200, text: async () => text })
  return {
    kind: 'preview',
    settings: { load: async () => ({ autoUpdate: false, appearance: 'auto' }), save: async () => {} },
    root: () => 'preview (nothing is saved)',
    chooseWorkspace: async () => null,
    store: {
      read: async (p) => { const v = files.get(p); if (v === undefined) throw new Error(`No file ${p}`); return v },
      write: async (p, t) => void files.set(p, t),
      exists: async (p) => files.has(p),
    },
    list: async (dir) => seen(dir),
    fetch: async (url, init) => {
      if (url.includes('europepmc')) return respond(JSON.stringify({ hitCount: 1, resultList: { result: [{ id: '7', pmid: '7', doi: '10.1/north', title: 'A study of the north', authorString: 'Author A.', pubYear: '2020', isOpenAccess: 'Y' }] } }))
      const p = new URLSearchParams(init?.body)
      if (p.get('db') === 'pubmed') return respond(JSON.stringify(url.includes('esummary') ? { result: {} } : { esearchresult: { count: '0', idlist: [] } }))
      if (url.includes('elink')) return respond(JSON.stringify({ linksets: [{}] }))
      if (p.get('db') === 'taxonomy') {
        if (url.includes('esearch')) return respond(JSON.stringify({ esearchresult: { count: '1', idlist: ['1'] } }))
        return respond('<TaxaSet><Taxon><ScientificName>Example taxon</ScientificName><LineageEx><Taxon><TaxId>9</TaxId><ScientificName>Examplidae</ScientificName><Rank>family</Rank></Taxon><Taxon><TaxId>8</TaxId><ScientificName>Examplus</ScientificName><Rank>genus</Rank></Taxon></LineageEx></Taxon></TaxaSet>')
      }
      if (p.get('term')?.startsWith('txid8')) return respond(JSON.stringify({ esearchresult: { count: '1', idlist: ['91'] } }))
      if (p.get('term')?.startsWith('txid9')) return respond(JSON.stringify({ esearchresult: { count: '2', idlist: ['92', '93'] } }))
      if (url.includes('esummary')) return respond(JSON.stringify({ result: { 91: { accessionversion: 'OUT91.1', organism: 'Examplus sister', slen: 900 }, 92: { accessionversion: 'OUT92.1', organism: 'Farther one', slen: 880 }, 93: { accessionversion: 'OUT93.1', organism: 'Farther two', slen: 870 } } }))
      if (url.includes('esearch')) {
        const ids = Object.keys(DB).filter((k) => k !== 'REF1.1')
        return respond(JSON.stringify({ esearchresult: { count: String(ids.length), idlist: ids.slice(Number(p.get('retstart') ?? 0)) } }))
      }
      return respond((p.get('id') ?? '').split(',').map((i) => DB[i] ?? '').join(''))
    },
    openTextFile: async () => ({ name: 'preview.fasta', text: PREVIEW_SAMPLE }),
    reveal: async () => {},
  }
}
