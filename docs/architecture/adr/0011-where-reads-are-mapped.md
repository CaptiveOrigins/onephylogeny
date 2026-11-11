# 0011: Where low-pass reads are mapped

**Status.** Decided by the owner, 2026-11-11 (N152): "A, and price B as a fallback". The sequencing lab maps the reads to our written spec, and Science prices our own batch job (B) now so it's ready if the chosen lab can't map to spec. Proposed by Science the same day (task K462; ADR 0010, decision 4). Low-pass storage is to be ready by about 2027-02-10 (D17).

**Context.** A low-pass kit gives about 4.6 Gb of reads (2× of a 2.3 Gb tortoise genome). To get the animal's mitogenome (ADR 0010), the reads are mapped to a reference and piled up; OnePhylogeny then builds the consensus from `samtools mpileup` text (`parseMpileup`, `consensusFromPileup`). Mapping is the heavy step.

Mapping only to the mitogenome is fast but unsafe: reads from nuclear copies (NUMTs) have nowhere better to go and pile onto it. Competitive mapping, against a nuclear genome and the mitogenome together, lets each read land where it fits best. That needs a nuclear reference of the species or a close relative, chosen and stated with its accession (ADR 0010, decision 5), and it needs real computing: a few CPU-hours per sample is a reasonable first guess, to be measured on our first run.

**Options.**

| | Who maps | What we receive | Cost to us | Fits |
| --- | --- | --- | --- | --- |
| **A. The lab** | The sequencing lab's own pipeline, to our written spec (competitive mapping, the stated references, mapping quality 20 or more) | CRAM plus `mpileup` of the mitogenome, or the CRAM alone | Usually part of the lab's price, or a small fee; nothing to run | Labs that offer alignment; most do |
| **B. Our batch job** | A short-lived cloud machine per batch of samples, started by the platform | Raw reads (FASTQ or unaligned CRAM) | Pay per hour of computing, only while it runs; an account to manage | Any lab, including ones that only deliver reads |
| **C. The Mac app** | The keeper's or curator's own Mac | Raw reads | Nothing to us; hours of the user's Mac, and a mapper to bundle | Researchers with their own data, not routine kits |

**Recommendation: A, with B kept ready as the fallback.**

- The software already takes a prepared pileup, so A needs nothing more from us than a written lab spec, and it keeps heavy computing off our bills and users' machines.
- B is needed only if the lab chosen can't map to spec. It's the same pipeline run by us; it can be built when that's known, priced first, with the plan watcher's cost alerts.
- C stays a research option. Routine kits should never make a keeper's Mac do hours of work.

**What the owner decided.** A as the routine path, with B priced now as the fallback (2026-11-11, N152). Still to do: write the lab spec when the lab is chosen, and price B. The price isn't known yet: the CPU-hours per sample above are a first guess and haven't been measured.
