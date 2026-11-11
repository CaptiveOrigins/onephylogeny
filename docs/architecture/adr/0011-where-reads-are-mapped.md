# 0011: Where low-pass reads are mapped

**Status.** Decided by the owner, 2026-11-11 (N152): "A, and price B as a fallback". The sequencing lab maps the reads to our written spec, and Science prices our own batch job (B) so it's ready if the chosen lab can't map to spec. B was priced the same day ("What B would cost", below). Proposed by Science the same day (task K462; ADR 0010, decision 4). Low-pass storage is to be ready by about 2027-02-10 (D17).

**Context.** A low-pass kit gives about 4.6 Gb of reads (2× of a 2.3 Gb tortoise genome). To get the animal's mitogenome (ADR 0010), the reads are mapped to a reference and piled up; OnePhylogeny then builds the consensus from `samtools mpileup` text (`parseMpileup`, `consensusFromPileup`). Mapping is the heavy step.

Mapping only to the mitogenome is fast but unsafe: reads from nuclear copies (NUMTs) have nowhere better to go and pile onto it. Competitive mapping, against a nuclear genome and the mitogenome together, lets each read land where it fits best. That needs a nuclear reference of the species or a close relative, chosen and stated with its accession (ADR 0010, decision 5), and it needs real computing: about 10 vCPU-hours per sample on a rented machine, by the estimate below.

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

**What the owner decided.** A as the routine path, with B priced now as the fallback (2026-11-11, N152). Still to do: write the lab spec when the lab is chosen.

**What B would cost** (priced 2026-11-11; nothing is built and nothing was spent).

- **Measured.** One run on an M2 Max, at the lowest priority on a busy machine: 12.06 Gb of public single-end RAD reads of *Chelonoidis carbonarius* (49 samples, 86.1 million reads) mapped to CheloAbing_2.0 with `bwa mem` 0.7.19 on 4 threads. Unpacking and trimming took 105 s of wall time per Gb, and mapping, sorting and filtering 739 s per Gb. `bwa mem` alone used 2,420 CPU-seconds per Gb. That is about 1.1 hours on 4 threads for a 4.6 Gb sample. Indexing the reference took 1,706 s, once. The reference and its index are 6.2 GB, and `bwa mem` holds the index in memory, so the machine needs 8 GB or more.
- **Estimated.** A kit's reads are paired whole-genome reads, which cost more per base than RAD reads, and a rented vCPU is slower than that Mac's fast cores. The planning figure is 10 vCPU-hours per sample, likely between 5 and 15. It isn't a measurement. One run of 4.6 Gb of public whole-genome reads would replace it.
- **Priced.** At list prices on 2026-11-11, 10 vCPU-hours on a 4 vCPU, 8 GB ARM machine is about $0.40 on AWS Fargate ($0.03238 per vCPU-hour and $0.00356 per GB-hour, us-east-1) and about $0.36 on EC2 `c7g.xlarge` ($0.145 an hour), from [AWS's price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-1/index.json) and its [EC2 on-demand page](https://aws.amazon.com/ec2/pricing/on-demand/). On Cloudflare Containers it is about $1.00 ([pricing](https://developers.cloudflare.com/containers/platform/pricing/), `standard-4`). So a sample costs between $0.20 and $0.60 to map on AWS. Spot prices weren't checked.
- **What follows.** Full competitive mapping is cheap enough as it is, so there's no case for a shortcut such as mapping to the mitogenome first. If B is built, it runs one sample at a time as a batch job with a timeout, behind a monthly ceiling the owner sets, and waiting samples can be mapped on a Mac we run instead. The platform's own cost plan has the details.
