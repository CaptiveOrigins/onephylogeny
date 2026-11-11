# Mitochondrial and nuclear DNA, and what low-pass adds

## Mitochondrial

Today's panels use mitochondrial DNA: one gene such as cytb (about 1,140 bases), or the whole mitogenome (about 16,500 bases and 37 genes). Mitochondrial DNA has a few properties that matter here:

- **It's one maternal line.** It's inherited from the mother only, with no mixing. A result says where an animal's maternal line fits, nothing about its father's side.
- **Hybrids and introgressed animals can mislead.** An animal can carry a mitochondrial lineage from elsewhere ([analysis protocol, section 6](../architecture/analysis-protocol.md#6-what-this-page-cant-fix)).
- **Nuclear copies can pose as it.** Pieces of mitochondrial DNA copied into the nuclear genome (NUMTs) can be amplified by mistake. A panel can be screened against a genome for them ([analysis protocol, section 7](../architecture/analysis-protocol.md#7-numt-screen)), and the Sanger check flags strong second peaks, which a nuclear copy can cause.

A whole mitogenome can separate lineages cytb can't. Mitogenome panels use one window per gene ([ADR 0009](../architecture/adr/0009-mitogenome-panels.md)). The engine builds them, tested on made-up records only so far.

## Nuclear

The nuclear genome comes from both parents and holds far more information, but it's much larger. The library can read SNPs from a prepared VCF and compare them with mitochondrial groups (`parseVcf`, `compareWithGroups`); the command line can't yet. There's no nuclear panel yet ([roadmap](../architecture/roadmap.md), stage 6).

## What low-pass sequencing adds

Low-pass sequencing reads an animal's whole genome thinly, about 0.5× to 2× on average ([ADR 0010](../architecture/adr/0010-low-pass-reads.md)). Nothing for it is built yet. The plan:

- **The mitogenome comes first.** A cell holds many mitochondrial genomes and one nuclear genome, so the mitogenome is read deeply even when the nuclear genome is read thinly. ADR 0010 estimates about 280× at 2× overall, if 0.1% of reads are mitochondrial. That gives a complete mitogenome per animal, which then goes through a mitogenome panel unchanged.
- **Nuclear data only as likelihoods.** At 2×, most nuclear sites have 0 to 4 reads, so single-site calls aren't reliable. They're kept as genotype likelihoods and used for relatedness and population structure, never single-site claims.
- **Where the reads are mapped** is a separate decision ([ADR 0011](../architecture/adr/0011-where-reads-are-mapped.md)).
