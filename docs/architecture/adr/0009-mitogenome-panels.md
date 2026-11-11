# 0009: Mitogenome panels are gene windows on one reference

**Status.** Proposed by Science, 2026-11-10, for roadmap stage 6.1 (task K197). The owner put mitogenomes first on 2026-11-10 ("Yes to your mitogenomes and low pass stuff first"). Parts built: decisions 1 to 4: `geneWindows`, `rotateToReference` and `geneChecks` in core (2026-11-10), and in the engine (2026-11-11) a profile whose marker is `mitogenome` turns circular, complete records before alignment, takes its windows from the reference's annotation when it gives none, puts left-out genes and the control region in `notCovered`, and records per-gene checks on each record outcome and in each result's QC. Decision 8: `geneCharsets` and `partitionNexus`, used by mitogenome trees (2026-11-11). Decisions 5 and 6 (2026-11-11): `geneSummary` on results from gene-window panels and an "Across genes" report section, and `routeSample` listing every panel that applies, with a gene panel's marker cut out of a whole mitogenome by `locateMarker` in routing and testing. Tested end to end on made-up records only (`fixtures/golden/mitogenome.gb`). Not built: turning a sample that isn't a GenBank record.

**Context.** A cytb panel compares about 1,140 bases in one or two windows. A whole mitochondrial genome has about 16,500 bases and 37 genes, which can separate lineages cytb can't, and it's what low-pass sequencing gives most cheaply (task K199). OnePhylogeny already has most of the pieces:

- The aligner places a whole mitogenome on a reference: 15,613 columns in 78 ms.
- Panels already evaluate window by window and report conflicts between windows.
- `locateMarker` already cuts a marker out of a circular genome.
- The GenBank reader already keeps every feature.

What's missing is a panel whose windows are genes, gene-level checks, and a test on real records.

**Decision.**

1. **One coordinate system.** A mitogenome panel's reference is one complete, annotated RefSeq mitogenome, as "Suggest a reference" already finds. Every record is turned to start where the reference starts, then aligned to it, so columns are reference positions, as in a cytb panel.
2. **Windows are genes, read from the reference's annotation.** There is one window per protein-coding gene, rRNA and tRNA, named by gene. Nothing is typed by hand. A gene whose annotation is missing or ambiguous in the reference isn't guessed at: it's left out and listed in `notCovered`.
3. **The control region is left out by default** and listed in `notCovered`. Its repeats, length differences and heteroplasmy make column-by-column comparison unreliable. A panel may include it only by stating so, with the reason.
4. **Gene-level checks.** Frame and stop codons are checked per protein-coding gene, on that gene's own strand (ND6 reads the other strand), with the panel's genetic code. The existing QC rules then apply per gene.
5. **Evaluation stays per window.** Each gene window is judged as today, with depth, sites and `not_resolved`. Results add a summary across all evaluable windows, but never a single probability (protocol section 6). Conflicts between genes are reported as conflicts between windows are now.
6. **Separate panels.** A cytb panel and a mitogenome panel of the same species are different panels. A mitogenome sample can still be tested against a cytb panel, because cytb is located inside it. `route` suggests every panel that applies.
7. **Evidence rules don't change.** Records excluded by decision stay excluded. That includes the 7 genomes fetched on 2026-11-06, which stay ungrouped (data repo DECISIONS.md). Records assigned by sequence still never shape a panel.
8. **Trees** get a partition file per gene and codon position for IQ-TREE. *Built 2026-11-11 (`geneCharsets`, `partitionNexus`, `tree.partitions`).*

**Consequences.**

- Most of the work is in core (gene windows from annotation, strand-aware checks, the summary across windows) and the engine (rotation before alignment, partitions). Panels and results keep schema version 2. A mitogenome panel is a version 2 panel with more windows.
- A real test needs a species with enough public mitogenomes from known places. Counts on NCBI on 2026-11-10 (complete mitochondrial genomes, 14 to 20 kb, by organism): *Chelonoidis carbonarius* 2, *Mauremys reevesii* 3, *Chrysemys picta* 5, *Chelonia mydas* 7, *Trachemys scripta* 7, *Caretta caretta* 8, *Pelodiscus sinensis* 18, *Gopherus agassizii* 0. So no turtle checked has enough for a validated mitogenome panel from public data. For redfoot, mitogenome panels will depend on new sequencing (low-pass, task K199) of animals from known places. The first check is the roadmap's stage 6 check on whichever species does, chosen from what NCBI lists and stated with its counts, never assumed.
- Low-pass reads (K199) feed this: a mitogenome assembled from a sample's reads is just another query.
