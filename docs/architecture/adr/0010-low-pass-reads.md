# 0010: Low-pass reads give a mitogenome first; nuclear data only as likelihoods

**Status.** Proposed by Science, 2026-11-11, for task K199. The owner's roadmap (2026-11-10): cytb, then SNPs or an equivalent, then low-pass whole genomes, then high-depth whole genomes, with storage ready for low-pass by about 2027-02-10 (D17). Nothing is built.

**Context.** Low-pass sequencing reads each animal's genome thinly, about 0.5× to 2× on average. A tortoise genome is about 2.3 Gb (genomic storage plan, section 1), so 2× is about 4.6 Gb of reads. Two very different kinds of data come out of it:

- **The mitogenome is read deeply.** A cell holds many mitochondrial genomes and one nuclear genome. The share of reads that are mitochondrial varies by tissue and method; 0.1% to a few percent is common, and it's to be measured on our own first runs. Even at 0.1%, 4.6 Gb of reads puts about 4.6 Mb on a 16.6 kb mitogenome, roughly 280× coverage. So low-pass gives a complete, well-supported mitogenome for every animal, cheaply.
- **The nuclear genome is read thinly.** At 2×, most sites are covered by 0 to 4 reads, so a heterozygous site often looks homozygous. Hard genotype calls at single sites aren't reliable at this depth. Imputation could fill them in, but it needs a reference panel of many deeply sequenced animals of the species, and none exists for redfoot.

**Decision.**

1. **Mitogenome first.** From low-pass reads, OnePhylogeny's first output is the animal's mitogenome: reads mapped to the panel's reference mitogenome, a consensus called with depth and base quality per position, and positions under a stated depth left as N. This query then goes through ADR 0009's mitogenome panel unchanged, and through the cytb panel too, because cytb is located inside it.
2. **Nuclear copies are the main risk.** Nuclear copies of mitochondrial DNA (NUMTs) also map to the mitogenome. At high mitochondrial depth they show up as minority bases at a position, not as the consensus. A position whose minority share passes a stated threshold is reported as mixed and not used as a difference. The same rule covers contamination and heteroplasmy. The genome NUMT screen (stage 1) still applies.
3. **Nuclear data as genotype likelihoods only.** Thin nuclear reads are kept as genotype likelihoods (the probability of each genotype given the reads), never as hard calls. They support relatedness and population structure through tools built for likelihoods (for example ANGSD, NGSrelate and PCAngsd), not single-site claims. This is a later step, after mitogenomes work, and each method gets its own design note.
4. **Where reads are processed is decided separately.** Mapping gigabases of reads is heavy for a Mac app. Whether it runs on a Mac, a server or a lab's pipeline is decided before it's built (roadmap stage 6, item 4). The software takes a prepared BAM, CRAM or consensus as well as raw reads, so labs can do the mapping.
5. **A nuclear reference genome is needed only for step 3.** The mitogenome needs only the panel's reference mitogenome. Nuclear work needs a genome of the species or a close relative, chosen and stated with its accession when step 3 starts.

**Consequences.**

- For redfoot, a mitogenome panel needs mitogenomes of animals from known places, and public data has only 2 (ADR 0009). Low-pass sequencing of such animals is the cheapest way to get them, so the first low-pass runs serve both: each animal's own result, and, where origin is known and consented to, the panel.
- Numbers here (mitochondrial share, depth and minority thresholds) are estimates or proposals until measured on our first runs, like every threshold in the analysis protocol.
- The storage plan's low-pass sizes (0.78 GB of CRAM per tortoise-sized kit) cover the reads; the mitogenome consensus and its depth profile add well under 1 MB.
