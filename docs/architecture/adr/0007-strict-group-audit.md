# 0007: The group audit uses only records that cover a window whole

**Status.** Accepted by the owner, 2026-11-10 (relayed verbatim: "Keep it strict (Recommended)").

**Context.** The group audit (`onephylogeny audit`, roadmap stage 3) checks a panel's proposed groups against the sequences, window by window. On fragmented data, records from different amplicons can look like clusters. So the rule, fixed before any real run, was to use only records with no gap inside the window. On the redfoot panel 0.7.1, no record covers the whole 5p window: it has 435 columns, and the best record covers 433. The audit therefore says nothing about 5p, including about Brazil east.

**Decision.** Keep the rule strict. The 5p gap is reported as a stated limit, and longer sequences will fill it later. The rule is not loosened after seeing the data.

**Consequences.** Each window's audit reports its width and the best coverage, so an empty window is explained rather than silent. A looser rule could only come as a new decision made before a run, never as a tweak to fit one.
