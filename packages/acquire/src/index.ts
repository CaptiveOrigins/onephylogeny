import { parseGenBank, type ExternalId, type GenBankRecord, type Marker, type Selection } from '@captiveorigins/onephylogeny-core'

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export type NcbiOptions = {
  fetch: FetchLike
  /** Sent to NCBI so it can identify the client. */
  tool?: string
  email?: string
  apiKey?: string
  /** Pause between requests. NCBI asks for at most 3 a second without a key. */
  delayMs?: number
  retries?: number
  sleep?: (ms: number) => Promise<void>
  log?: (level: 'info' | 'warning', message: string, data?: Record<string, unknown>) => void
}

export class AcquireError extends Error {}

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'

/** A small NCBI E-utilities client. Failed requests retry, then throw: nothing is skipped silently. */
export class NcbiClient {
  private readonly o: Required<Pick<NcbiOptions, 'delayMs' | 'retries' | 'sleep'>> & NcbiOptions
  constructor(options: NcbiOptions) {
    this.o = { delayMs: options.apiKey ? 120 : 380, retries: 4, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), ...options }
  }

  async request(path: string, params: Record<string, string>): Promise<string> {
    const body = new URLSearchParams({ ...params, tool: this.o.tool ?? 'onephylogeny', ...(this.o.email ? { email: this.o.email } : {}), ...(this.o.apiKey ? { api_key: this.o.apiKey } : {}) }).toString()
    let lastError = ''
    for (let attempt = 0; attempt <= this.o.retries; attempt++) {
      if (attempt) await this.o.sleep(Math.min(30000, 1000 * 2 ** attempt))
      await this.o.sleep(this.o.delayMs)
      try {
        const res = await this.o.fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
        if (res.ok) return await res.text()
        lastError = `HTTP ${res.status}`
        if (res.status < 500 && res.status !== 429) break
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
      this.o.log?.('warning', `${path} failed (${lastError}), attempt ${attempt + 1} of ${this.o.retries + 1}`)
    }
    throw new AcquireError(`${path} failed: ${lastError}`)
  }

  private async json(path: string, params: Record<string, string>): Promise<Record<string, any>> {
    const text = await this.request(path, { ...params, retmode: 'json' })
    try {
      return JSON.parse(text)
    } catch {
      throw new AcquireError(`${path} did not return JSON: ${text.slice(0, 120)}`)
    }
  }

  /** Accession versions for a search, every page of them. A short read is an error. */
  async searchAccessions(term: string, page = 5000): Promise<string[]> {
    const out: string[] = []
    let total = 0
    do {
      const r = await this.json('esearch.fcgi', { db: 'nuccore', term, idtype: 'acc', retmax: String(page), retstart: String(out.length) })
      const res = r.esearchresult
      if (!res || res.ERROR) throw new AcquireError(`Search failed: ${String(res?.ERROR ?? 'no result')}`)
      total = Number(res.count)
      const ids: string[] = res.idlist ?? []
      if (!ids.length && out.length < total) throw new AcquireError(`Search stopped at ${out.length} of ${total} records`)
      out.push(...ids)
    } while (out.length < total)
    return [...new Set(out)]
  }

  async count(term: string): Promise<number> {
    const r = await this.json('esearch.fcgi', { db: 'nuccore', term, retmax: '0' })
    return Number(r.esearchresult?.count ?? 0)
  }

  /** Raw GenBank text for these accessions, checked to contain exactly what was asked for. */
  async fetchGenBankText(ids: string[]): Promise<{ text: string; records: GenBankRecord[] }> {
    const text = await this.request('efetch.fcgi', { db: 'nuccore', id: ids.join(','), rettype: 'gbwithparts', retmode: 'text' })
    const records = parseGenBank(text)
    const got = new Set(records.flatMap((r) => [r.version, r.accession]))
    const missing = ids.filter((id) => !got.has(id) && !got.has(id.split('.')[0]!))
    if (missing.length) throw new AcquireError(`NCBI did not return ${missing.length} of ${ids.length} records, including ${missing.slice(0, 3).join(', ')}`)
    return { text, records }
  }

  async summaries(term: string, retmax = 300): Promise<{ accession: string; organism: string; length: number; title: string; taxid?: string }[]> {
    const search = await this.json('esearch.fcgi', { db: 'nuccore', term, retmax: String(retmax) })
    const ids: string[] = search.esearchresult?.idlist ?? []
    if (!ids.length) return []
    const r = await this.json('esummary.fcgi', { db: 'nuccore', id: ids.join(',') })
    return ids.map((id) => r.result?.[id]).filter(Boolean).map((s: any) => ({ accession: s.accessionversion, organism: s.organism, length: Number(s.slen), title: s.title, taxid: s.taxid ? String(s.taxid) : undefined }))
  }

  /** Finds a taxon by scientific name. More than one result is returned for a person to choose from. */
  async findTaxon(name: string): Promise<{ id: string; scientificName: string }[]> {
    const r = await this.json('esearch.fcgi', { db: 'taxonomy', term: `${quote(name)}[Scientific Name]`, retmax: '5' })
    const ids: string[] = r.esearchresult?.idlist ?? []
    const out: { id: string; scientificName: string }[] = []
    for (const id of ids) out.push({ id, scientificName: (await this.lineage(id)).scientificName })
    return out
  }

  /** A taxon's ancestors, nearest first. */
  async lineage(taxid: string): Promise<{ scientificName: string; ancestors: TaxonStep[] }> {
    const xml = await this.request('efetch.fcgi', { db: 'taxonomy', id: taxid, retmode: 'xml' })
    const name = /<ScientificName>([^<]+)<\/ScientificName>/.exec(xml)?.[1]
    if (!name) throw new AcquireError(`Taxon ${taxid} was not found`)
    const lineage = /<LineageEx>([\s\S]*?)<\/LineageEx>/.exec(xml)?.[1] ?? ''
    const ancestors = [...lineage.matchAll(/<Taxon>\s*<TaxId>(\d+)<\/TaxId>\s*<ScientificName>([^<]+)<\/ScientificName>\s*<Rank>([^<]*)<\/Rank>/g)].map((m) => ({ id: m[1]!, name: m[2]!, rank: m[3]! })).reverse()
    return { scientificName: name, ancestors }
  }
}

export type TaxonStep = { id: string; name: string; rank: string }

const quote = (s: string) => `"${s.replace(/"/g, '')}"`

/** The part of a query that names a marker. Comes entirely from configuration. */
export function markerTerm(marker: Marker): string {
  if (marker.kind === 'mitogenome') return '(mitochondrion[Filter] AND ("complete genome"[Title] OR "partial genome"[Title]))'
  if (marker.kind === 'snp') throw new AcquireError('SNP data has no NCBI nucleotide search. Import a prepared dataset instead')
  const names = [marker.gene, ...(marker.synonyms ?? [])].filter(Boolean) as string[]
  const fields = [...names.map((n) => `${quote(n)}[Gene]`), ...(marker.products ?? []).map((p) => `${quote(p)}[Protein Name]`)]
  if (!fields.length) throw new AcquireError('A gene marker must name its gene')
  const organelle = marker.organelle === 'mitochondrion' ? 'gene_in_mitochondrion[PROP] AND ' : marker.organelle === 'plastid' ? 'gene_in_plastid[PROP] AND ' : ''
  return `${organelle}(${fields.join(' OR ')})`
}

const ncbiTaxa = (taxa: ExternalId[]) => {
  const ids = taxa.filter((t) => t.source === 'ncbi-taxonomy').map((t) => t.id)
  if (!ids.length) throw new AcquireError('NCBI searches need taxa from the ncbi-taxonomy source')
  return ids
}

/**
 * Mitochondrial genomes of the same taxa, whatever they annotate. A genome can hold the marker with no feature naming it,
 * so the marker search can't see it. Only for a mitochondrial gene, where a whole genome would contain the marker.
 */
export function genomesHoldingMarkerQuery(selection: Selection): string | null {
  const { marker } = selection
  if (marker.kind !== 'gene' || marker.organelle !== 'mitochondrion') return null
  const taxa = ncbiTaxa(selection.taxa).map((id) => `txid${id}[Organism:exp]`).join(' OR ')
  return `(${taxa}) AND mitochondrion[Filter] AND 10000:25000[SLEN] NOT refseq[Filter]`
}

export function selectionQuery(selection: Selection): string {
  const taxa = ncbiTaxa(selection.taxa).map((id) => `txid${id}[Organism:exp]`).join(' OR ')
  return `(${taxa}) AND ${markerTerm(selection.marker)} NOT refseq[Filter]`
}

export type OutgroupCandidate = { accession: string; organism: string; length: number; taxid?: string }

export type OutgroupStep = {
  taxon: TaxonStep
  /** Records for this marker inside this ancestor, excluding the previous step. */
  records: number
  species: string[]
  candidates: OutgroupCandidate[]
  sufficient: boolean
}

export type OutgroupLadder = { ingroup: string; steps: OutgroupStep[]; suggested: OutgroupStep | null; caveat: string }

/**
 * Walks outward from the ingroup through the taxonomy, one ancestor at a time, until enough species have this
 * marker. Taxonomy isn't phylogeny, so a rank step suggests where to look; the finished tree must confirm it.
 */
export async function suggestOutgroups(client: NcbiClient, selection: Selection, options: { minSpecies?: number; maxSteps?: number; minLength?: number; perSpecies?: number } = {}): Promise<OutgroupLadder> {
  const { minSpecies = 2, maxSteps = 8, minLength = 0, perSpecies = 1 } = options
  const taxid = ncbiTaxa(selection.taxa)[0]!
  const { scientificName, ancestors } = await client.lineage(taxid)
  const marker = markerTerm(selection.marker)
  const steps: OutgroupStep[] = []
  let suggested: OutgroupStep | null = null
  let inner = taxid
  for (const taxon of ancestors.slice(0, maxSteps)) {
    const term = `txid${taxon.id}[Organism:exp] NOT txid${inner}[Organism:exp] AND ${marker} NOT refseq[Filter]`
    const records = await client.count(term)
    const summaries = records ? await client.summaries(term) : []
    const bySpecies = new Map<string, OutgroupCandidate[]>()
    for (const s of summaries) {
      if (s.length < minLength) continue
      const list = bySpecies.get(s.organism)
      if (list) list.push(s)
      else bySpecies.set(s.organism, [s])
    }
    const candidates = [...bySpecies.values()].flatMap((list) => list.sort((a, b) => b.length - a.length).slice(0, perSpecies))
    const step: OutgroupStep = { taxon, records, species: [...bySpecies.keys()].sort(), candidates: candidates.sort((a, b) => b.length - a.length), sufficient: bySpecies.size >= minSpecies }
    steps.push(step)
    inner = taxon.id
    if (step.sufficient) {
      suggested = step
      break
    }
  }
  return { ingroup: scientificName, steps, suggested, caveat: 'Taxonomic rank is not evidence of ancestry. Check that the ingroup is monophyletic and these outgroups fall outside it in the finished tree.' }
}

export * from './papers.js'
export * from './lookup.js'
