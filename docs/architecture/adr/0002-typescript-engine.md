# 0002 — TypeScript engine, native tools as separate programs

**Context.** The first version was Python scripts over Biopython, with a Bash driver. Earlier research proposed Snakemake for panel builds.

**Decision.** Port to TypeScript with one step runner for the CLI and the Mac app. Aligners and tree builders stay native and are called as separate programs through a `ToolRunner` port. The Python scripts stay in a private repo as a reference.

**Consequences.** No Python or workflow engine on users' Macs, and one language across the tools. We take on incremental rebuild logic that Snakemake would provide, and the port must be re-verified against known answers.
