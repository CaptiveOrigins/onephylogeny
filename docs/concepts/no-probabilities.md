# Why there are no probabilities

OnePhylogeny doesn't say "92% likely group A". It gives statuses from stated rules, and counts.

The reasons are in the [analysis protocol, section 6](../architecture/analysis-protocol.md#6-what-this-page-cant-fix). In short:

- **The sites aren't independent tests.** Mitochondrial DNA is inherited as one piece down the maternal line. Thirty agreeing sites are one history, not thirty pieces of evidence, so multiplying them into a probability would overstate it badly.
- **Sampling is uneven.** A probability over groups assumes the groups cover the possibilities. They don't: a lineage can come from a place nobody has sampled.
- **The rules aren't calibrated.** Thresholds such as `minSharedColumns` and `tolerance` are stated, configured values. A probability would need them calibrated against animals of known origin, and that hasn't been done ([scientific invariants](../architecture/scientific-invariants.md), P15).

What you get instead:

- A status per group, with the reason and the numbers behind it.
- For a panel, validation counts: how often each status was right when known records were held out, by group, window and study. Those are counts, such as "29 of 29", never turned into a probability ([limitations](../architecture/limitations.md)).

Every result repeats this in its caveats: "Rules are configured values and these statuses are not probabilities".
