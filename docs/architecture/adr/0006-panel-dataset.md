# 0006: A panel is a dataset that proves itself

**Status.** Built 2026-11-10 for roadmap stage 2 ("Make panels real datasets"). The dataset also carries a generated `README.md`, its citations and the software that built it (`builtWith`, in `dataset.json`). Compatibility is shown by rerunning the examples rather than declared as a version range, since a range can be wrong and a rerun can't. A per-panel changelog is left to the panel's maintainers.

**Context.** A panel is a sealed `panel.json` plus `panel.fasta`. The seal shows the files weren't edited. It doesn't show that this copy, read by this version of the software, still gives the answers the panel gave when it was built. Nextclade's datasets carry example sequences with expected results for exactly that reason.

**Decision.** A built panel's folder also holds two files.

- `examples.json`, chosen from the panel itself, the same way every time:
  - per group, the longest member with location evidence;
  - a 300-base fragment from the middle of the first of those;
  - a control that isn't the marker, which must be refused.

  Each example records what it gave at build time: every group's status and every pair's state, or the error codes that refused it.
- `dataset.json`, the SHA-256 of every file that travels with the panel: `panel.json`, `panel.fasta`, `validation.json`, `diagnostics.json` and `examples.json`. `artifact.json` is left out, because it points into one machine's store.

`onephylogeny verify --dir DIR` does three checks:
1. checks the hashes;
2. checks the seal;
3. reruns every example through the same `testSample` the app, CLI and Payload plugin use.

Any difference is an error naming the example and both answers. `onephylogeny dataset --dir DIR` adds the two files to a panel built before they existed. A panel version keeps the examples it was published with: writing different ones is refused.

**Consequences.**

- A copy can now be checked on another machine and under another software version. A change to the evaluator that changes an answer fails `verify` rather than passing silently. Releasing a changed evaluator then means building a new panel version, or confirming the change on purpose.
- Examples are the panel's own public records, already in `panel.fasta`, so they add nothing new to disclose.
- Examples record answers; they don't prove them right. Rightness is the validation report's job.
- The examples are panel-derived, so a panel with one tiny group gets a weak member example for it. The 0.7.1 redfoot panel shows this: its Guianas and South Chaco members come out `not_evaluable` even against their own group. That is what it can't speak to, recorded honestly.
