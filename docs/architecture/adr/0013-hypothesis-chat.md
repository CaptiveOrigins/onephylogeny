# 0013: Hypothesis chat is a deterministic core with an optional language layer

**Status.** The deterministic core is accepted by Science (the area lead), 2026-11-11. The optional language layer is not decided: it needs its own design and the owner's explicit yes before any model is called.

## Context

Roadmap stage 9 asks for a way to put a claim to the data: "Read-only and optional. It states its test before running it, cites a run for each verdict, and uses the closed verdict list (refuted, not refuted, untestable with this data, tool or data problem)." Its check is that, given a false claim and an untestable one, it says so, with evidence.

The tempting build is a chat box with a language model reading the results and answering. That would let the model decide what a test is, which data counts and what the answer means, and none of that could be checked or repeated. The analysis protocol (section 3) says groups are hypotheses, refusing is a valid result and no probability is shown. A model's paraphrase can break all three without anyone noticing.

Everything a test needs already exists: saved results with findings and pairs (`evaluateQuery`), sealed panels with pair tables (`verifyBundle` re-derives them), results kept per panel version, and the uncalibrated distance rule for novelty (`noveltyByDistance`, protocol section 8).

## Decision

1. **The core is deterministic and takes structured claims.** It starts with four claim kinds, a closed set:

   | Claim | In words | Read from |
   | --- | --- | --- |
   | `sample-in-group` | Sample X belongs to group G | X's saved result against one panel version, and that panel |
   | `groups-distinct` | Group G is distinct from group H in window W | The panel's pair table for G, H and W |
   | `panel-changed-call` | Panel version B changed the call for record R | R's saved results against versions A and B, and both panels |
   | `possibly-novel` | This sample is possibly novel | X's saved result and aligned sequence, and the panel's records |

   A claim may name its panel version. When it doesn't and more than one version could apply, the claim is untestable with that reason; the core never picks one.

2. **The test is stated before it runs.** `planTest(claim, artifacts)` returns the function it will use, the rule, what each verdict will mean for this claim, and every artifact it will read with its type, key and hash. It reads only what it needs to name those artifacts, never an outcome. If a result, panel, group or window is missing, or two artifacts could each be the one meant, the plan is `untestable with this data` with the reason, and nothing runs.

3. **It runs on saved artifacts only.** `runTest(plan, artifacts)` reads the artifacts the plan named and nothing else. It never builds a panel, evaluates a new sequence, fetches or writes. Before reading anything it checks that each artifact is still the one the plan named (same hash), that the store hasn't reported changed files, that each panel passes its seal and re-derivation (`verifyBundle`), and that each result passes `validateResult` against its panel. Any failure is `tool or data problem`, with the diagnostics. The plan comes back unchanged with the verdict.

4. **One verdict from the closed list, with what it rests on.** Every verdict carries citations: artifact type and key, its hash, the run that made a result, the path inside it (`findings.2`, `pairs.4`, `distance-novelty.windows.0`) and the finding or row in words. There is no `confirmed`: a test that fails to refute a claim says `not refuted`, and says that isn't confirmation.

5. **How each claim maps to a verdict.** Fixed here, before any use:

   - `sample-in-group`: `refuted` only if G is `excluded_within_panel` in X's result, citing the finding and the resolved pairs that rule G out. `not refuted` if G is `consistent` or `inconclusive`; an inconclusive finding is named as such, since it means compared but not ruled out, not a fit. `untestable with this data` if G is `not_evaluable` or there is no result.
   - `groups-distinct`: "distinct" means at least one column, with enough records in both groups, where they share no possible base. `refuted` if the pair is `no_fixed_sites`, `not refuted` if `resolvable` (with the sites, and whether the pair is a validated claim), `untestable with this data` if `not_evaluable`.
   - `panel-changed-call`: the call is the finding status per group. `not refuted` if any compared group's status differs or a group is in only one version; `refuted` if every status is the same. If the two results don't record the same sequence hash, it's untestable, because nothing shows they tested the same sequence.
   - `possibly-novel`: the uncalibrated distance rule. `not refuted` if `possibly-novel`, `refuted` if `within-range`, `untestable with this data` if `not-evaluable` or `windows-disagree`, since the rule leaves disagreement unsettled. The plan and the verdict both say it's uncalibrated and carry `calibrated: false`.

6. **Every verdict carries its limits.** Results are exploratory (protocol section 1), anything outside the panel's validated scope is listed, and a check the caller didn't do (the store's file hashes) is named rather than assumed.

7. **An optional language layer, later and separately.** It could only translate a person's words into one of the structured claims, show the stated test for the person to accept, and put the verdict back into plain words without changing it or its citations. It would never choose the test, the artifacts or the verdict. It is out of scope here. It needs its own design, and an explicit setting the person turns on, before any model call; without that setting nothing calls a model, and the structured claims work on their own.

## Consequences

- The verdicts can be repeated: the same plan on the same artifacts gives the same answer, and a reader can follow each citation to the finding it names.
- Four claim kinds are narrow. A claim outside them can't be asked yet; adding one means stating its mapping here first.
- The verdicts inherit every limit of what they read. `refuted` for a group means excluded within this panel; `refuted` for novelty rests on an uncalibrated rule and is weak evidence.
- Built since (2026-11-11, part 2): the engine side (`testHypothesis`, `runHypothesis`), which loads artifacts from the store with their file checks, and the `onephylogeny hypothesis` command. Still to build: a Mac app view that shows the stated test before it runs.
