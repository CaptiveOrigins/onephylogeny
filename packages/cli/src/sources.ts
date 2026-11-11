import { LISTING_KINDS, type Count, type Coverage, type ListingKind, type Provenance, type PublicListings } from '@captiveorigins/onephylogeny-acquire'

/** Which listings `sources` asks for: the flags given, or all of them when none is. */
export function chosenKinds(has: (flag: string) => boolean): ListingKind[] {
  const picked = LISTING_KINDS.filter((k) => has(k))
  return picked.length ? picked : [...LISTING_KINDS]
}

/** Rows shown per table before the rest are summed up. `--json` always has every row. */
export const ROWS = 20

const n = (v: number) => v.toLocaleString('en-US')
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`

/** A plain-text table: a header, a rule, then rows. Columns given as numeric are right-aligned. */
export function table(head: string[], rows: string[][], numeric: number[] = []): string {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]) => cells.map((c, i) => (numeric.includes(i) ? c.padStart(width[i]!) : c.padEnd(width[i]!))).join('  ').trimEnd()
  return [line(head), width.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n')
}

/** Counts as a table, cut at `ROWS` with the rest summed in one line, so nothing is silently dropped. */
function counts(label: string, items: Count[]): string {
  if (!items.length) return `${label}: none listed.`
  const shown = items.slice(0, ROWS)
  const rest = items.slice(ROWS)
  const more = rest.length ? `\n…and ${plural(rest.length, 'more row')}, with ${plural(rest.reduce((s, c) => s + c.count, 0), 'record')} between them (--json lists every one).` : ''
  return `${table([label, 'Records'], shown.map((c) => [c.name, n(c.count)]), [1])}${more}`
}

const provenance = (p: Provenance) => `Query: ${p.query}\nRetrieved: ${p.retrieved} (${plural(p.requests.length, 'request')})`
const notes = (list: string[]) => (list.length ? `\n\n${list.map((x) => `Note: ${x}`).join('\n')}` : '')

function failedHere(listing: PublicListings, service: string): string | null {
  const f = listing.failed.find((x) => x.service === service)
  return f ? `Failed, so this count is unknown, not zero: ${f.message}` : null
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`
}

function sra(l: PublicListings): string {
  const failed = failedHere(l, 'NCBI SRA')
  if (failed || !l.sra) return section('NCBI SRA runs', failed ?? 'Not asked.')
  const s = l.sra
  const cut = s.experiments.listed < s.experiments.total ? ` Only the first ${n(s.experiments.listed)} were read.` : ''
  const head = `${plural(s.experiments.total, 'experiment')} in SRA, ${plural(s.runs.length, 'run')} listed.${cut} A listing only: no reads were downloaded.`
  if (!s.runs.length) return section('NCBI SRA runs', `${head}\n\n${provenance(s)}`)
  const rows = s.runs.slice(0, ROWS).map((r) => [r.run, r.libraryStrategy ?? '', r.layout ?? '', r.platform ?? '', r.bases !== undefined ? n(r.bases) : 'not given', r.bioProject ?? '', r.bioSample ?? '', r.published ?? ''])
  const more = s.runs.length > ROWS ? `\n…and ${plural(s.runs.length - ROWS, 'run')} more (--json lists every one).` : ''
  return section('NCBI SRA runs', `${head}\n\n${table(['Run', 'Strategy', 'Layout', 'Platform', 'Bases', 'BioProject', 'BioSample', 'Published'], rows, [4])}${more}\n\n${provenance(s)}`)
}

function genomes(l: PublicListings): string {
  const failed = failedHere(l, 'NCBI Datasets')
  if (failed || !l.genomes) return section('NCBI Datasets genomes', failed ?? 'Not asked.')
  const g = l.genomes
  const cut = g.genomes.length < g.total ? ` Only ${n(g.genomes.length)} were read.` : ''
  const head = `${plural(g.total, 'assembly', 'assemblies')}.${cut} A listing only: nothing was downloaded.`
  if (!g.genomes.length) return section('NCBI Datasets genomes', `${head}\n\n${provenance(g)}`)
  const rows = g.genomes.slice(0, ROWS).map((x) => [x.accession, x.database === 'refseq' ? 'RefSeq' : x.database === 'genbank' ? 'GenBank' : 'unknown', x.assemblyLevel ?? '', x.length !== undefined ? n(x.length) : '', x.released ?? '', x.mitogenome, x.pairedAccession ?? ''])
  const more = g.genomes.length > ROWS ? `\n…and ${plural(g.genomes.length - ROWS, 'assembly', 'assemblies')} more (--json lists every one).` : ''
  const mito = g.genomes.some((x) => x.mitogenome === 'not listed') ? '\nNote: "not listed" doesn\'t mean the assembly has no mitogenome: check the paired accession too.' : ''
  return section('NCBI Datasets genomes', `${head}\n\n${table(['Accession', 'Database', 'Level', 'Length (bases)', 'Released', 'Mitogenome', 'Paired with'], rows, [3])}${more}${mito ? `\n${mito}` : ''}\n\n${provenance(g)}`)
}

function coverage(l: PublicListings, service: 'GBIF' | 'iDigBio', c: Coverage | null): string {
  const title = `${service} occurrence counts`
  const failed = failedHere(l, service)
  if (failed || !c) return section(title, failed ?? 'Not asked.')
  const matched = `Matched: ${c.matched.name}${c.matched.rank ? `, ${c.matched.rank.toLowerCase()}` : ''}${c.matched.key ? ` (key ${c.matched.key})` : ''}${c.matched.matchType ? `, ${c.matched.matchType.toLowerCase()} match` : ''}.`
  const total = `${plural(c.total, 'record')}${c.datasets !== undefined ? ` from ${plural(c.datasets, 'dataset')}` : ''}${c.noCountry ? `; ${n(c.noCountry)} with no country` : ''}. Counts only: no record and no coordinate was fetched.`
  const licences = c.licences === null ? 'Licences: not indexed per record by this service.' : counts('Licence', c.licences)
  return section(title, `${matched}\n${total}\n\n${counts('Country', c.byCountry)}\n\n${counts('Basis of record', c.byBasisOfRecord)}\n\n${licences}${notes(c.notes)}\n\n${provenance(c)}`)
}

function bold(l: PublicListings): string {
  const failed = failedHere(l, 'BOLD')
  if (failed || !l.bold) return section('BOLD record counts', failed ?? 'Not asked.')
  const b = l.bold
  return section('BOLD record counts', `Matched: ${b.matched}. Counts only: no record and no coordinate was fetched.\n\n${counts('Country or ocean', b.byCountry)}\n\n${counts('Marker', b.byMarker)}${notes(b.notes)}\n\n${provenance(b)}`)
}

/**
 * What `onephylogeny sources` prints: one section per source asked for, each with what was found, its counts, the
 * query URL and when it was retrieved. A service that failed says so in its own section and again at the end, by name,
 * so a missing count never reads as zero.
 */
export function sourcesText(l: PublicListings): string {
  const named = l.name && l.nameFrom === 'ncbi-taxonomy' ? `GBIF, iDigBio and BOLD were asked about ${l.name}, NCBI Taxonomy's name for taxon ${l.taxon}.\n` : ''
  const out = [
    `# Public data for ${l.taxon}\n\nListings and counts of what public services hold. They aren't evidence about any sample, and no coordinates are fetched or shown. GBIF and iDigBio overlap (iDigBio publishes to GBIF), so don't add their counts together.\n${named}`,
  ]
  if (l.asked.includes('sra')) out.push(sra(l))
  if (l.asked.includes('genomes')) out.push(genomes(l))
  if (l.asked.includes('occurrences')) out.push(coverage(l, 'GBIF', l.gbif), coverage(l, 'iDigBio', l.idigbio))
  if (l.asked.includes('bold')) out.push(bold(l))
  out.push(l.failed.length
    ? `## Failed\n\n${plural(l.failed.length, 'service')} didn't answer, so ${l.failed.length === 1 ? 'its counts are' : 'their counts are'} unknown, not zero:\n${l.failed.map((f) => `- ${f.service}: ${f.message}`).join('\n')}\n`
    : 'Every service asked answered.\n')
  return out.join('\n')
}
