# 0012: Nuclear relatedness and structure from low-pass genotype likelihoods

**Status.** Proposed by Science, 2026-11-11, task K463 (ADR 0010, decision 3). Design only. Nothing is built, and nothing here has been run on tortoise data. Every threshold below is a starting value to be fixed in a preregistered test before use, as in the [analysis protocol](../analysis-protocol.md).

## Context

ADR 0010 keeps thin nuclear reads as genotype likelihoods, never hard calls, and leaves each method to its own design note. This is that note for relatedness and population structure. It covers what the methods are, what their papers actually tested, what we would build, and what we refuse.

### Genotype likelihoods

A genotype likelihood is, up to a scaling factor, the probability of the reads at one site given each possible genotype (Korneliussen et al. 2014). At a site covered by one read, the likelihoods for "homozygous" and "heterozygous" differ only a little, and that uncertainty is carried forward instead of being rounded to a call.

ANGSD computes them from BAM or CRAM files. Its paper lists four models: SAMtools, GATK, SOAPsnp, and a type-specific error model. The paper says the analysis is "highly sensitive to the chosen GL model": on the same data, the GATK model found more variable sites and more rare alleles than the SAMtools model. Most of its methods assume a diploid organism.

What depth is enough depends on the question. The papers read for this note tested:

| Method | Depths tested | Sites | Samples |
| --- | --- | --- | --- |
| NgsRelate v1, simulation | 1×, 2×, 4×, 8×, 16× | 100,000 | 100 pairs per relationship |
| NgsRelate v2, simulation | 1×, 2×, 4×, 8×, 16× | 10,000, 30,000, 50,000 | pairs of cousins, 100 runs each |
| NgsRelate v1 and v2, real data | about 4× (1000 Genomes) | v2: about 4.6 million (MAF > 0.05) | 6 related pairs |
| R0, R1, KING, real data | about 4× | subsets of 2 to 50 million | 5 people, 10 pairs |
| PCAngsd, simulation | 0.5× to 5× per animal | about 0.4 million SNPs | 380 (as printed; the groups described add to 180) |
| PCAngsd, waterbuck | 2.2× to 4.7× | 9.4 million SNPs | 73 from 5 places; small places dropped |

So 2× is inside what was tested for relatedness, 1× is at the edge (NgsRelate v1: "large variance", but better than called genotypes), and 0.5× wasn't tested for relatedness in either NgsRelate paper. For structure, 0.5× was the bottom of PCAngsd's simulated range. **Whether our 0.5× to 2× kits give usable relatedness is unknown until we test it.**

Known biases, from those papers and Lou and Therkildsen (2022):

- **GL model choice** changes results (above).
- **Batch effects.** Samples sequenced in different batches (chemistry, run, read length, DNA quality, depth) severely biased diversity, structure and selection scans in a naive pipeline. Trimming and SNP filtering detected and largely removed it. Mixing labs or runs is exactly what a kit service does.
- **Reference bias and misassembly.** Reads that differ from the reference map less well. Our reference is from another species (below), and cross-species scaffolding can introduce misassemblies (Jensen et al. 2025).
- **Uneven depth** between animals, which the batch-effects paper names among the causes.
- **Linkage.** NgsRelate v2 treats sites as independent, so its likelihood is a composite likelihood, and its simulations didn't model linkage. PCAngsd's simulations didn't either.

Lou et al. (2021) found that spreading a fixed amount of sequencing over more animals at lower depth "consistently improves the accuracy of most types of inference, with a few notable exceptions". Their abstract gives no thresholds, and the full text wasn't available to read for this note.

### Relatedness: NgsRelate v2

NgsRelate v2 (Hanghøj et al. 2019) takes genotype likelihoods and population allele frequencies and estimates, per pair: the nine condensed Jacquard coefficients, relatedness, kinship (`rab`), each animal's inbreeding (`Fa`, `Fb`) and related summaries. It also gives R0, R1 and KING-robust kinship from the pair's two-dimensional frequency spectrum, which need no population allele frequencies (Waples et al. 2019). Its output is a tab-separated table with one row per pair, including `nSites` and `nIter`. An `nIter` of -1 means a value on the edge of the parameter space had a higher likelihood. Bootstrap intervals (`-B`) are available for single pairs.

What its paper reports:

- Relatedness and inbreeding were estimated correctly with 10,000 segregating sites in its simulations; the separate Jacquard coefficients needed 50,000 or more.
- It assumes one homogeneous population and Hardy-Weinberg equilibrium. Structure and admixture weren't analyzed.
- The optimizer finds a local optimum, so the authors suggest several starts.

R0, R1 and KING separate parent-offspring, full siblings, half siblings and first cousins from unrelated pairs on SNP-array data (precision and recall 0.96 to 0.99 for parent-offspring, full siblings and unrelated). On about 4× data, every subset but the smallest (2 million sites) gave point estimates like the full data. They assume no inbreeding and one homogeneous population; first cousins can't always be told from more distant pairs. Their confidence intervals need reads placed on chromosomes.

Captive redfoot are likely to break both assumptions: founders came from different places, and some lines are inbred. That's why every use needs its own validation (decision 7).

### Relatedness and OnePedigree

OnePedigree's `kinshipAnalysis` computes kinship, F, mean kinship and gene diversity from the studbook, labelled **pedigree-based**, and exports PMx's `.ped` file. Pedigree kinship counts shared ancestry back to founders that are assumed unrelated. A genomic estimate measures sharing against the allele frequencies of the animals in the sample. The two have different baselines, so their values aren't directly comparable. What can be compared is the relationship class: a recorded parent and offspring should look like parent and offspring, and recorded strangers shouldn't look like full siblings.

So a genomic estimate can **check** a studbook: flag a recorded parent whose estimate doesn't fit, or show which candidate in a MULT slot fits best. It never edits a parent link, a MULT probability or PMx input. A person reviews each flag and changes the studbook, with a reason, if they decide to.

### Population structure: PCAngsd

PCAngsd (Meisner and Albrechtsen 2018; README v1.37.0, GPL-3.0) works on genotype likelihoods. It estimates each animal's allele frequencies from the data, builds a covariance matrix for PCA, and estimates admixture proportions for K clusters, with K set to the number of components plus one. It writes the covariance matrix (`.cov`), and with `--admix`, admixture proportions (`.Q`) and cluster frequencies (`.F`).

Its paper gives no minimum sample size. It says the number of animals per population is essential for components that describe real structure, and that small clusters add noise. Its component-count test can fail when structure is complex and depth low and uneven. In the waterbuck data, places with fewer than about 10 samples were left out (the paper's wording varies on the exact cut). Admixture accuracy was a little worse than NGSadmix.

A PCA axis or a cluster is a pattern in the animals sampled. It's not a place. A captive animal near a wild group on a plot shares variation with that group; that's all.

### Reference genome

NCBI Datasets, queried 2026-11-11 (genus *Chelonoidis*, family Testudinidae):

| Accession | Species | Assembly | Level | Size | Scaffold N50 | Contig N50 |
| --- | --- | --- | --- | --- | --- | --- |
| GCF_003597395.2 (GCA_003597395.2) | *Chelonoidis abingdonii* | CheloAbing_2.0 | Chromosome | 2.26 Gb | 148 Mb | 119 kb |
| GCA_046118415.1 | *Chelonoidis denticulatus* | ASM4611841v1 | Scaffold | 2.00 Gb | 13.8 kb | 13.3 kb |
| GCA_026122505.1 | *Aldabrachelys gigantea* | AldGig_1.0 | Chromosome | 2.37 Gb | 149 Mb | 58.7 Mb |

There's no assembly for *C. carbonarius*. CheloAbing_2.0 is the same assembly the NUMT screen uses. It was made by ordering the 2018 contigs against AldGig_1.0, with no new sequencing (Jensen et al. 2025), so its chromosomes come from another genus's layout and its contigs are short. The *C. denticulatus* assembly is in the same genus, but its pieces are too short for chromosome-based intervals. How far each is from redfoot isn't measured here, and reference bias has to be checked, not assumed (decision 6).

## Decision

1. **Read, never reimplement.** OnePhylogeny core gets pure TypeScript readers for NgsRelate's result table and PCAngsd's covariance, admixture and log files. ANGSD, NgsRelate and PCAngsd run as separate programs (ADR 0002), wherever ADR 0011 decides reads are mapped, and are never bundled in the Mac app. Each reader is written against a real output file from a recorded tool version, and refuses columns or versions it doesn't know. Every result records the tool versions, the ANGSD GL model, filters, reference accession and the site count.
2. **Relatedness is shown as estimates with intervals.** Per pair: kinship, the R0/R1/KING values, sites used, and an interval (bootstrap or chromosome jackknife). A relationship class is shown only where a validated rule supports it, as "consistent with" a class, never as a probability. A pair with `nIter` -1 is marked "on a boundary".
3. **Structure is shown as patterns, not origins.** PCA plots and admixture bars, labelled with the sample set, K and the component test's result. Wild reference animals are labelled by generalized region only (ADR 0008). No result says or implies a probability of origin.
4. **What's refused.** A pair with fewer sites than its validated minimum (starting value 10,000, the least NgsRelate v2 reported working for relatedness), an animal under its validated minimum depth (starting value 1×, the lowest depth either NgsRelate paper tested), a structure run whose reference groups have fewer than the validated minimum each (starting value 10, from the waterbuck filter), and any run that mixes batches without the batch check passing. Refusal names the rule and the number that failed.
5. **The studbook is checked, never replaced.** OnePedigree gets genomic relatedness through a documented plain JSON file or an optional bridge (ADR 0005), never a code dependency. It shows disagreement with a recorded link as a flag for the studbook keeper. It never changes parentage, MULT probabilities, kinship or PMx output by itself. Pedigree-based and genomic numbers stay separately labelled.
6. **One reference, stated.** The first reference is CheloAbing_2.0 (GCF_003597395.2), matching the NUMT screen and ADR 0011's competitive mapping. Reference bias is measured in validation (mapping rate and heterozygosity by sample group). A switch to another assembly is a new method version.
7. **Each method gets its own preregistered validation before use.** Relatedness and structure are separate methods, each with a test page written and pushed before its data is seen (protocol section 10), naming the tool versions, GL model, filters, minimum sites and depth, and pass criteria. Relatedness: animals with known relationships (studbook parent-offspring and siblings, ideally confirmed independently), plus shuffled identities and pairs from unrelated sources as controls, and a depth series from deeper data cut down to 0.5×, 1× and 2×. Structure: wild animals from documented places, held out by whole site, with the no-structure and shuffled-label controls from protocol section 4, and a batch check across at least two runs. A method that fails stays off, and the failure is reported.
8. **Privacy.** Tool inputs and outputs use opaque sample codes. Animal names, holders and owners never enter them; the mapping stays in the platform. No coordinates are read, kept or plotted. Who sees a pair's relatedness follows OnePedigree's rule for kinship (decisions, 2026-11-10: the coordinator sees everything, members see their own animals), so a member never sees an estimate involving someone else's animal they couldn't otherwise see.

## What this can't do

- It can't say where an animal came from. Structure shows similarity to the animals sampled, and unsampled places look like nothing.
- It can't give single-site genotypes, identify an individual forensically, or confirm a species.
- It can't separate first cousins from more distant relatives reliably, even in the papers' own tests.
- It can't promise anything at 0.5×. Neither NgsRelate paper tested below 1×.
- It can't correct a studbook on its own, and its numbers aren't on the same scale as pedigree kinship.
- Mixed founders and inbred lines break assumptions both relatedness methods make. Validation measures how much that matters; it doesn't remove it.

## Consequences

- Nothing in core changes until a real output file of each tool exists to write the reader against.
- The tools need a Linux or Mac command line with enough memory. NgsRelate v2's own benchmark (135 people, 164 million sites) needed 45 GB to 83 GB of memory. Our sets will be far smaller, but the cost per run is measured, not guessed, and falls under ADR 0011's choice.
- Genotype likelihood files add to storage. Their size per animal isn't known yet and is to be measured on the first run.
- Validation needs animals of known relationship and wild animals from documented places, sequenced low-pass. Until then this stays design.
- Stage 6.4's SNP route (prepared VCF, 3RAD dataset) continues on its own and can serve as a check: the same animals by both routes should agree on structure.

## Open questions for the owner

1. **Who runs the tools:** the same choice as ADR 0011 (lab, our batch job, or neither yet). Recommended: decide with ADR 0011, since the tools run where the reads are mapped.
2. **Validation animals:** whether to budget low-pass sequencing for a set of known families and for wild-documented animals. This note doesn't set a number or a spend.
3. **OnePedigree link:** a plain JSON file that OnePedigree reads (recommended, no new package), or an optional bridge package.

## Sources

- Korneliussen TS, Albrechtsen A, Nielsen R (2014). ANGSD: Analysis of Next Generation Sequencing Data. BMC Bioinformatics 15:356. doi 10.1186/s12859-014-0356-4
- Korneliussen TS, Moltke I (2015). NgsRelate: a software tool for estimating pairwise relatedness from next-generation sequencing data. Bioinformatics 31(24):4009–4011. doi 10.1093/bioinformatics/btv509
- Hanghøj K, Moltke I, Andersen PA, Manica A, Korneliussen TS (2019). Fast and accurate relatedness estimation from high-throughput sequencing data in the presence of inbreeding. GigaScience 8(5):giz034. doi 10.1093/gigascience/giz034
- NgsRelate README, https://github.com/ANGSD/NgsRelate (read 2026-11-11)
- Waples RK, Albrechtsen A, Moltke I (2019). Allele frequency-free inference of close familial relationships from genotypes or low-depth sequencing data. Molecular Ecology 28(1):35–48. doi 10.1111/mec.14954
- Meisner J, Albrechtsen A (2018). Inferring population structure and admixture proportions in low-depth NGS data. Genetics 210(2):719–731. doi 10.1534/genetics.118.301336
- PCAngsd README, v1.37.0, https://github.com/Rosemeis/pcangsd (read 2026-11-11)
- Lou RN, Jacobs A, Wilder AP, Therkildsen NO (2021). A beginner's guide to low-coverage whole genome sequencing for population genomics. Molecular Ecology 30(23):5966–5993. doi 10.1111/mec.16077 (abstract only)
- Lou RN, Therkildsen NO (2022). Batch effects in population genomic studies with low-coverage whole genome sequencing data. Molecular Ecology Resources 22(5):1678–1692. doi 10.1111/1755-0998.13559 (abstract only)
- Jensen EL et al. (2025). Synteny enabled upgrade of the Galapagos giant tortoise genome improves inferences of runs of homozygosity. Ecology and Evolution 15(4):e71358. doi 10.1002/ece3.71358
- NCBI Datasets genome reports for *Chelonoidis* and Testudinidae, https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/Testudinidae/dataset_report (queried 2026-11-11)
