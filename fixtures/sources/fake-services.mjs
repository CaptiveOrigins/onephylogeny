// Made-up answers shaped like NCBI SRA (E-utilities), NCBI Taxonomy, NCBI Datasets v2, GBIF, iDigBio and BOLD, for
// tests of `onephylogeny sources` and the Mac app's Public data section. The shapes follow the real services as checked
// by hand on 2026-11-11 (see packages/acquire/test/sources.test.ts); every name, accession and count is invented, and no
// answer holds a coordinate or a person. Anything else is refused, so nothing leaves the machine.

export const FAKE_TAXON = { id: '999001', name: 'Examplus exemplaris' }

/** Services a test can make fail: each answers HTTP 503 (or 429 for `bold`, a refusal). */
export const FAKE_SERVICES = ['sra', 'taxonomy', 'datasets', 'gbif', 'idigbio', 'bold']

const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
const xml = (body) => ({ ok: true, status: 200, text: async () => body })
const down = (status = 503) => ({ ok: false, status, text: async () => '' })

const sraDoc = (n, layout, strategy, bases) => ({
  uid: String(n),
  expxml: `<Summary><Title>Example run ${n}</Title><Platform instrument_model="Illumina NovaSeq 6000">ILLUMINA</Platform></Summary><Experiment acc="SRX90000${n}" ver="1"/><Study acc="SRP900001"/><Organism taxid="${FAKE_TAXON.id}" ScientificName="${FAKE_TAXON.name}"/><Library_descriptor><LIBRARY_STRATEGY>${strategy}</LIBRARY_STRATEGY><LIBRARY_SOURCE>GENOMIC</LIBRARY_SOURCE><LIBRARY_SELECTION>RANDOM</LIBRARY_SELECTION><LIBRARY_LAYOUT><${layout}/></LIBRARY_LAYOUT></Library_descriptor><Bioproject>PRJNA900001</Bioproject><Biosample>SAMN9000000${n}</Biosample>`,
  runs: `<Run acc="SRR90000${n}" total_spots="${bases / 300}" total_bases="${bases}" is_public="true"/>`,
  createdate: '2025/08/14',
})

const genome = (accession, level, length, organelles) => ({
  accession,
  source_database: accession.startsWith('GCF') ? 'SOURCE_DATABASE_REFSEQ' : 'SOURCE_DATABASE_GENBANK',
  organism: { tax_id: Number(FAKE_TAXON.id), organism_name: FAKE_TAXON.name },
  assembly_info: { assembly_level: level, assembly_status: 'current', assembly_name: `exEx${accession.slice(-3, -2)}`, release_date: '2024-03-01' },
  assembly_stats: { total_sequence_length: String(length) },
  organelle_info: organelles.map((description) => ({ description })),
})

/**
 * A fetch that answers like the services above. `failing` names services from `FAKE_SERVICES` to fail; `calls`, if
 * given, collects every URL asked for.
 */
export function fakeSourcesFetch({ failing = [], calls } = {}) {
  const fails = new Set(failing)
  return async (url, init = {}) => {
    const u = String(url)
    calls?.push(u)
    if (u.startsWith('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/')) {
      const p = new URLSearchParams(init.body ?? '')
      const db = p.get('db')
      if (db === 'sra') {
        if (fails.has('sra')) return down()
        if (u.endsWith('esearch.fcgi')) return json({ esearchresult: { count: '3', idlist: ['1', '2'] } })
        if (u.endsWith('esummary.fcgi')) return json({ result: { uids: ['1', '2'], 1: sraDoc(1, 'PAIRED', 'WGS', 3_000_000_000), 2: sraDoc(2, 'SINGLE', 'RAD-Seq', 450_000) } })
      }
      if (db === 'taxonomy' && u.endsWith('efetch.fcgi')) {
        if (fails.has('taxonomy')) return down()
        return xml(`<TaxaSet><Taxon><TaxId>${FAKE_TAXON.id}</TaxId><ScientificName>${FAKE_TAXON.name}</ScientificName><LineageEx><Taxon><TaxId>999000</TaxId><ScientificName>Examplus</ScientificName><Rank>genus</Rank></Taxon></LineageEx></Taxon></TaxaSet>`)
      }
      throw new Error(`Fake sources: no answer for ${db} ${u}`)
    }
    if (u.startsWith('https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/')) {
      if (fails.has('datasets')) return down()
      return json({ reports: [genome('GCA_900000001.1', 'Chromosome', 2_460_542_086, ['Mitochondrion']), genome('GCF_900000001.1', 'Chromosome', 2_460_542_086, [])], total_count: 2 })
    }
    if (u.startsWith('https://api.gbif.org/v1/species/match')) {
      if (fails.has('gbif')) return down()
      return json({ usageKey: 9990001, scientificName: `${FAKE_TAXON.name} (Example, 1900)`, canonicalName: FAKE_TAXON.name, rank: 'SPECIES', status: 'ACCEPTED', matchType: 'EXACT' })
    }
    if (u.startsWith('https://api.gbif.org/v1/occurrence/search')) {
      if (fails.has('gbif')) return down()
      return json({ offset: 0, limit: 0, count: 1250, results: [], facets: [
        { field: 'COUNTRY', counts: [{ name: 'CO', count: 700 }, { name: 'BR', count: 450 }] },
        { field: 'BASIS_OF_RECORD', counts: [{ name: 'HUMAN_OBSERVATION', count: 1000 }, { name: 'PRESERVED_SPECIMEN', count: 230 }, { name: 'LIVING_SPECIMEN', count: 20 }] },
        { field: 'LICENSE', counts: [{ name: 'CC_BY_NC_4_0', count: 800 }, { name: 'CC_BY_4_0', count: 450 }] },
        { field: 'DATASET_KEY', counts: [{ name: 'a', count: 900 }, { name: 'b', count: 300 }, { name: 'c', count: 50 }] },
      ] })
    }
    if (u.startsWith('https://search.idigbio.org/v2/summary/top/records/')) {
      if (fails.has('idigbio')) return down()
      if (u.includes('basisofrecord')) return json({ basisofrecord: { preservedspecimen: { itemCount: 40 } }, itemCount: 40 })
      return json({ country: { colombia: { itemCount: 25 }, brasil: { itemCount: 12 } }, itemCount: 40 })
    }
    if (u.startsWith('https://portal.boldsystems.org/api/query/preprocessor')) {
      if (fails.has('bold')) return down(429)
      return json({ successful_terms: [{ submitted: `tax:na:${FAKE_TAXON.name}`, matched: `tax:species:${FAKE_TAXON.name}` }] })
    }
    if (u.startsWith('https://portal.boldsystems.org/api/summary')) {
      if (fails.has('bold')) return down(429)
      return json({ 'country/ocean': { Colombia: 6, Unrecoverable: 2 }, marker_code: { 'COI-5P': 8 } })
    }
    throw new Error(`Fake sources: refused a request to ${u}`)
  }
}
