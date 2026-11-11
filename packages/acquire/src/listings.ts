import { AcquireError, type FetchLike, type NcbiClient } from './index.js'
import { boldCoverage, datasetsGenomes, gbifCoverage, idigbioCoverage, listSraRuns, type BoldCoverage, type Coverage, type GenomeListing, type SourceOptions, type SraListing } from './sources.js'

/**
 * Every record-source listing for one taxon in one call, for the CLI's `sources` command and the Mac app's Public data
 * section. It only calls the functions in `sources.ts`, one after another, and changes none of what they do. A service
 * that fails is named in `failed`, and its slot stays `null`, so a missing count never reads as zero.
 */

export type ListingKind = 'sra' | 'genomes' | 'occurrences' | 'bold'
export const LISTING_KINDS: readonly ListingKind[] = ['sra', 'genomes', 'occurrences', 'bold']

export type ListingFailure = { service: string; message: string }

export type PublicListings = {
  /** The taxon as given: an NCBI Taxonomy ID or a scientific name. */
  taxon: string
  /**
   * The scientific name GBIF, iDigBio and BOLD were asked about: as given, or NCBI Taxonomy's name for a Taxonomy ID.
   * `null` when none of them was asked, or the ID couldn't be named.
   */
  name: string | null
  nameFrom: 'given' | 'ncbi-taxonomy' | null
  /** What was asked for, in order. A kind not asked for stays `null` and isn't a failure. */
  asked: ListingKind[]
  retrieved: string
  sra: SraListing | null
  genomes: GenomeListing | null
  gbif: Coverage | null
  idigbio: Coverage | null
  bold: BoldCoverage | null
  failed: ListingFailure[]
}

export async function publicListings(
  services: { fetch: FetchLike; client: NcbiClient },
  taxon: string,
  options: SourceOptions & { only?: readonly ListingKind[]; sraLimit?: number } = {},
): Promise<PublicListings> {
  const t = taxon.trim()
  if (!t) throw new AcquireError('Name a taxon')
  const asked = LISTING_KINDS.filter((k) => !options.only?.length || options.only.includes(k))
  const at = options.at ?? new Date().toISOString()
  const o: SourceOptions = { ...options, at }
  const out: PublicListings = { taxon: t, name: null, nameFrom: null, asked, retrieved: at, sra: null, genomes: null, gbif: null, idigbio: null, bold: null, failed: [] }
  const attempt = async <T>(service: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work()
    } catch (e) {
      out.failed.push({ service, message: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  if (asked.includes('sra')) out.sra = await attempt('NCBI SRA', () => listSraRuns(services.client, t, { at, ...(options.sraLimit ? { limit: options.sraLimit } : {}) }))
  if (asked.includes('genomes')) out.genomes = await attempt('NCBI Datasets', () => datasetsGenomes(services.fetch, t, o))

  const byName: { kind: ListingKind; service: string }[] = [
    ...(asked.includes('occurrences') ? [{ kind: 'occurrences' as const, service: 'GBIF' }, { kind: 'occurrences' as const, service: 'iDigBio' }] : []),
    ...(asked.includes('bold') ? [{ kind: 'bold' as const, service: 'BOLD' }] : []),
  ]
  if (!byName.length) return out
  // GBIF, iDigBio and BOLD take a scientific name, so a Taxonomy ID is named by NCBI first. If that fails, each of them
  // is listed as failed with the reason, rather than asked about the digits.
  if (/^\d+$/.test(t)) {
    try {
      out.name = (await services.client.lineage(t)).scientificName
      out.nameFrom = 'ncbi-taxonomy'
    } catch (e) {
      const why = `needs a scientific name, and NCBI Taxonomy couldn't name taxon ${t}: ${e instanceof Error ? e.message : String(e)}`
      for (const { service } of byName) out.failed.push({ service, message: `${service} ${why}` })
      return out
    }
  } else {
    out.name = t
    out.nameFrom = 'given'
  }
  const name = out.name
  if (asked.includes('occurrences')) {
    out.gbif = await attempt('GBIF', () => gbifCoverage(services.fetch, name, o))
    out.idigbio = await attempt('iDigBio', () => idigbioCoverage(services.fetch, name, o))
  }
  if (asked.includes('bold')) out.bold = await attempt('BOLD', () => boldCoverage(services.fetch, name, o))
  return out
}
