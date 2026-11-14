# @extantape/onephylogeny-acquire

OnePhylogeny acquire: fetches sequence records by taxon and marker with safe retries and no duplicates, keeps raw files with hashes, and suggests outgroups outward through the taxonomy.

See the [repository](https://github.com/ExtantApe/OnePhylogeny) for documentation.

## More sources

Listings and counts from other services (roadmap stage 6.2). Nothing here downloads reads, genomes or individual occurrence records. Each result carries `source`, `retrieved` (ISO time), `query` (a URL a person can open) and `requests` (every request made).

| Function | Service | Returns |
| --- | --- | --- |
| `listSraRuns(client, taxon)` | NCBI SRA (E-utilities) | One row per run: run, experiment, study, BioProject, BioSample, library strategy, source, selection, layout, platform, instrument, bases, spots. `experiments.total` against `experiments.listed` shows a list cut short by `limit` (500 by default). |
| `biosampleFor(client, accessions)` | NCBI BioSample (E-utilities) | Organism, taxon and a short list of attributes (isolate, sex, tissue, `geo_loc_name`, collection date and a few more). Accessions not found are in `missing`. |
| `datasetsGenomes(fetch, taxon)` | NCBI Datasets v2 | Genome assemblies: accession, GenBank or RefSeq, paired accession, assembly level, length, release date, organelles listed, and `mitogenome: 'listed' \| 'not listed'`. |
| `occurrenceCoverage(fetch, name)` | GBIF and iDigBio | Record counts by country and by basis of record. GBIF also gives counts by licence and the number of datasets. |
| `boldCoverage(fetch, name)` | BOLD portal | Record counts by country or ocean, and by marker. |

A taxon for the NCBI functions is a Taxonomy ID (digits) or a scientific name, subtaxa included. GBIF, iDigBio and BOLD take a scientific name.

What it won't do:

- **No coordinates.** BioSample attributes named like coordinates (`lat_lon`, `decimal_latitude` and so on), and any value shaped like one, are dropped as they're parsed and never returned or kept. `withheld` lists the attribute names left out, never their values. The occurrence counts never ask for a record, so no coordinate is fetched. Contacts, submitters and owners are never read.
- **No guessed matches.** A name GBIF only matches at a higher rank is refused rather than counted for the genus. A fuzzy match is counted and says so in `notes`. A name BOLD can't resolve is refused.
- **No hidden gaps.** `occurrenceCoverage` lists a service that failed in `failed`, so a missing count never reads as zero. GBIF and iDigBio overlap, because iDigBio publishes to GBIF: don't add them together. iDigBio doesn't index a licence per record, so its `licences` is `null`. BOLD's summary gives no total or licence, so neither is reported.

Etiquette: Datasets, GBIF, iDigBio and BOLD calls are paced inside each function, one request at a time and at least a second apart, with a User-Agent naming this tool and its repository and never a person. A refusal (HTTP 403 or 429) is reported and not retried. The E-utilities calls go through `NcbiClient`, which keeps to NCBI's three requests a second and retries a few times with growing waits before giving up. The reported `query` never includes an email or API key.

`publicListings({ fetch, client }, taxon, { only })` runs the listings above for one taxon, one after another, with one retrieval time. A Taxonomy ID is named by NCBI Taxonomy first, since GBIF, iDigBio and BOLD take names; if it can't be named, they're listed as failed rather than asked about the digits. A service that fails is in `failed` by name and its slot is `null`. The `onephylogeny sources` command and the Mac app's Public data section use it.

Dryad, Figshare and Zenodo aren't searched: they stay flagged for a person to review.
