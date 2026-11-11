import { LISTING_KINDS, NcbiClient, publicListings, type Count, type Coverage, type ListingKind, type Provenance, type PublicListings } from '@captiveorigins/onephylogeny-acquire'
import type { Profile } from '@captiveorigins/onephylogeny-core'
import type { EngineContext } from '@captiveorigins/onephylogeny-engine'
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { Platform } from './platform'

const KIND_LABELS: Record<ListingKind, string> = {
  sra: 'SRA runs (NCBI)',
  genomes: 'Genome assemblies (NCBI Datasets)',
  occurrences: 'Occurrence counts (GBIF and iDigBio)',
  bold: 'Barcode counts (BOLD)',
}

/** Rows shown per table before a "Show all" button. */
export const PUBLIC_ROWS = 20

const n = (v: number) => v.toLocaleString('en-US')
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`

/** Where a listing came from, under its table: the query a person can open, and when it was asked. */
function Source({ p }: { p: Provenance }) {
  return <p className="muted">Query: <code className="query">{p.query}</code>. Retrieved {p.retrieved.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}, {plural(p.requests.length, 'request')}.</p>
}

function Failed({ service, message }: { service: string; message: string }) {
  return <p className="error">{service} didn't answer, so this is unknown, not zero: {message}</p>
}

/** A table that shows its first rows and offers the rest, so a long listing stays readable and nothing is hidden. */
function Table({ caption, head, rows, numeric = [] }: { caption: string; head: string[]; rows: ReactNode[][]; numeric?: number[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, PUBLIC_ROWS)
  return <>
    <table className="ophy-table public-table">
      <caption>{caption}</caption>
      <thead><tr>{head.map((h, i) => <th key={h} scope="col" className={numeric.includes(i) ? 'num' : undefined}>{h}</th>)}</tr></thead>
      <tbody>{shown.map((r, k) => <tr key={k}>{r.map((c, i) => i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i} className={numeric.includes(i) ? 'num' : undefined}>{c}</td>)}</tr>)}</tbody>
    </table>
    {rows.length > PUBLIC_ROWS && <button type="button" aria-expanded={all} onClick={() => setAll(!all)}>{all ? `Show the first ${PUBLIC_ROWS}` : `Show all ${n(rows.length)} rows of ${caption.toLowerCase()}`}</button>}
  </>
}

const countRows = (items: Count[]) => items.map((c) => [c.name, n(c.count)])

function CoverageBlock({ service, c }: { service: string; c: Coverage }) {
  return <>
    <p>Matched {c.matched.name}{c.matched.rank ? `, ${c.matched.rank.toLowerCase()}` : ''}{c.matched.matchType ? `, ${c.matched.matchType.toLowerCase()} match` : ''}. {plural(c.total, 'record')}{c.datasets !== undefined ? ` from ${plural(c.datasets, 'dataset')}` : ''}{c.noCountry ? `; ${n(c.noCountry)} with no country` : ''}.</p>
    {c.byCountry.length ? <Table caption={`${service} records by country`} head={['Country', 'Records']} rows={countRows(c.byCountry)} numeric={[1]} /> : <p className="muted">No country listed.</p>}
    {c.byBasisOfRecord.length > 0 && <Table caption={`${service} records by basis of record`} head={['Basis of record', 'Records']} rows={countRows(c.byBasisOfRecord)} numeric={[1]} />}
    {/* A service with no licence per record says so in its notes, below. */}
    {c.licences !== null && c.licences.length > 0 && <Table caption={`${service} records by licence`} head={['Licence', 'Records']} rows={countRows(c.licences)} numeric={[1]} />}
    {c.notes.length > 0 && <ul className="muted">{c.notes.map((x) => <li key={x}>{x}</li>)}</ul>}
    <Source p={c} />
  </>
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return <section aria-labelledby={id} className="public-source"><h4 id={id}>{title}</h4>{children}</section>
}

/** Every listing asked for, one block per service. A service that failed says so where its numbers would be. */
export function PublicListingsView({ listing: l }: { listing: PublicListings }) {
  const failed = (service: string) => l.failed.find((f) => f.service === service)
  const body = (service: string, value: unknown, render: () => ReactNode) => {
    const f = failed(service)
    return f ? <Failed service={service} message={f.message} /> : value ? render() : null
  }
  return <div role="region" aria-label="Public data listings">
    {l.nameFrom === 'ncbi-taxonomy' && <p className="muted">GBIF, iDigBio and BOLD were asked about {l.name}, NCBI Taxonomy's name for taxon {l.taxon}.</p>}
    {l.failed.length > 0 && <div role="alert" className="error"><p>Not every service answered, so these listings are incomplete. A missing count is unknown, not zero:</p><ul>{l.failed.map((f) => <li key={f.service}>{f.service}: {f.message}</li>)}</ul></div>}
    {l.asked.includes('sra') && <Block title="NCBI SRA runs">{body('NCBI SRA', l.sra, () => {
      const s = l.sra!
      return <>
        <p>{plural(s.experiments.total, 'experiment')}, {plural(s.runs.length, 'run')} listed.{s.experiments.listed < s.experiments.total ? ` Only the first ${n(s.experiments.listed)} experiments were read.` : ''} No reads were downloaded.</p>
        {s.runs.length > 0 && <Table caption="SRA runs" head={['Run', 'Strategy', 'Layout', 'Platform', 'Bases', 'BioProject', 'BioSample', 'Published']} numeric={[4]} rows={s.runs.map((r) => [r.run, r.libraryStrategy ?? '–', r.layout ?? '–', r.platform ?? '–', r.bases !== undefined ? n(r.bases) : 'Not given', r.bioProject ?? '–', r.bioSample ?? '–', r.published ?? '–'])} />}
        <Source p={s} />
      </>
    })}</Block>}
    {l.asked.includes('genomes') && <Block title="NCBI Datasets genome assemblies">{body('NCBI Datasets', l.genomes, () => {
      const g = l.genomes!
      return <>
        <p>{plural(g.total, 'assembly', 'assemblies')}{g.genomes.length < g.total ? `, ${n(g.genomes.length)} read` : ''}. Nothing was downloaded. "Not listed" doesn't mean an assembly has no mitogenome: check the paired accession too.</p>
        {g.genomes.length > 0 && <Table caption="Genome assemblies" head={['Accession', 'Database', 'Level', 'Length (bases)', 'Released', 'Mitogenome', 'Paired with']} numeric={[3]} rows={g.genomes.map((x) => [x.accession, x.database === 'refseq' ? 'RefSeq' : x.database === 'genbank' ? 'GenBank' : 'Unknown', x.assemblyLevel ?? '–', x.length !== undefined ? n(x.length) : '–', x.released ?? '–', x.mitogenome === 'listed' ? 'Listed' : 'Not listed', x.pairedAccession ?? '–'])} />}
        <Source p={g} />
      </>
    })}</Block>}
    {l.asked.includes('occurrences') && <>
      <Block title="GBIF occurrence counts">{body('GBIF', l.gbif, () => <CoverageBlock service="GBIF" c={l.gbif!} />)}</Block>
      <Block title="iDigBio occurrence counts">{body('iDigBio', l.idigbio, () => <CoverageBlock service="iDigBio" c={l.idigbio!} />)}</Block>
    </>}
    {l.asked.includes('bold') && <Block title="BOLD barcode counts">{body('BOLD', l.bold, () => {
      const b = l.bold!
      return <>
        <p>Matched {b.matched}.</p>
        {b.byCountry.length ? <Table caption="BOLD records by country or ocean" head={['Country or ocean', 'Records']} rows={countRows(b.byCountry)} numeric={[1]} /> : <p className="muted">No country listed.</p>}
        {b.byMarker.length > 0 && <Table caption="BOLD records by marker" head={['Marker', 'Records']} rows={countRows(b.byMarker)} numeric={[1]} />}
        {b.notes.length > 0 && <ul className="muted">{b.notes.map((x) => <li key={x}>{x}</li>)}</ul>}
        <Source p={b} />
      </>
    })}</Block>}
  </div>
}

/**
 * Public data (roadmap stage 6.2): what NCBI SRA, NCBI Datasets, GBIF, iDigBio and BOLD list for the profile's taxon.
 * It asks only when the button is pressed, never on its own, and sends nothing but the taxon. Listings and counts only:
 * no reads, genomes or records are downloaded, and no coordinates are fetched or shown.
 */
export function PublicDataSection({ profile, platform, context, attempt, busy }: {
  profile: Profile; platform: Platform; context: () => EngineContext
  attempt: (l: string, w: () => Promise<void>) => Promise<void>; busy: boolean
}) {
  const heading = useId()
  const taxa = profile.selection.taxa.filter((t) => t.source === 'ncbi-taxonomy')
  const [taxon, setTaxon] = useState(taxa[0]?.id ?? '')
  const [kinds, setKinds] = useState<ListingKind[]>([...LISTING_KINDS])
  const [listing, setListing] = useState<PublicListings | null>(null)
  // Another profile's listing is never left on screen.
  useEffect(() => { setListing(null); setTaxon(taxa[0]?.id ?? '') }, [profile.id])

  const list = () => attempt('Listing public data', async () => {
    setListing(null)
    // The app's NCBI settings: the tool name and no email or key.
    const ncbi = context().ncbi
    setListing(await publicListings({ fetch: platform.fetch, client: new NcbiClient(ncbi) }, taxon, { only: kinds }))
  })
  const toggle = (k: ListingKind) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : LISTING_KINDS.filter((x) => x === k || ks.includes(x))))

  return (
    <section className="pane public-data" aria-labelledby={heading}>
      <h3 id={heading}>Public data</h3>
      <p className="muted">What public services list for this taxon: sequencing runs, genome assemblies and how many occurrence and barcode records exist, by country. These are listings and counts, not evidence: they don't place any animal or sample. No coordinates are fetched or shown, and nothing is downloaded. It asks NCBI, GBIF, iDigBio and BOLD only when you press the button, and sends them only the taxon.</p>
      {taxa.length === 0
        ? <p className="muted">This profile has no NCBI Taxonomy taxon yet. Add one in Setup to list public data.</p>
        : <form onSubmit={(e) => { e.preventDefault(); void list() }}>
            {taxa.length > 1 && <label className="field"><span>Taxon</span><select value={taxon} onChange={(e) => { setTaxon(e.target.value); setListing(null) }}>{taxa.map((t) => <option key={t.id} value={t.id}>NCBI Taxonomy {t.id}</option>)}</select></label>}
            <fieldset className="plain-fieldset">
              <legend>Sources</legend>
              {LISTING_KINDS.map((k) => <label key={k} className="check"><input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} /> {KIND_LABELS[k]}</label>)}
            </fieldset>
            <div className="actions">
              <button type="submit" className="primary" disabled={busy || !kinds.length || !taxon}>List public data</button>
              <span className="muted">For NCBI Taxonomy {taxon} and its subtaxa.</span>
              {!kinds.length && <span className="muted">Pick at least one source.</span>}
            </div>
          </form>}
      {listing && <PublicListingsView listing={listing} />}
    </section>
  )
}
