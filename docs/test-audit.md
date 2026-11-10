# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

## 2026-11-10: panel methods text

`packages/core/test/methods.test.ts` (3 tests) covers what the methods text promises:

- **It describes the panel from what it records**, with rules stated as configured values, its limits, the caveat and the citations.
- **It counts validated claims by basis, and names a nuclear-copy screen.**
- **It never writes a coordinate-like number.**

Checked by hand on the real panel 0.7.1. That check caught wording that misdescribed `tolerance` and the nuclear-copy screen, both fixed against the model's definitions before commit.

## 2026-11-10: conflict reporting

`packages/core/test/conflicts.test.ts` (5 tests) and one report test cover what conflict reporting promises:

- **A clean result reports nothing.**
- **It reports** several consistent groups; windows that disagree, measured by rate (a tie shared across windows isn't a disagreement); and comparisons that favour a ruled-out group or go against the fitting one.
- **The wording is plain**, and reports show conflicts in their own section.

Checked by hand on the 8 saved redfoot results (see the changelog).

## 2026-11-10: guided setup

What the suggestion promises, and the proof:

- **`reference.test.ts` (4 tests, fake NCBI):**
  - the taxon's own RefSeq mitogenome comes first, with its supported genetic code;
  - when the taxon has none, it walks up to a relative and says so;
  - an unsupported code (5) and a non-mitochondrial marker get no frame check, with the reason;
  - with no taxon, it asks for one.
- **`app.test.tsx`:** a marker not known to be mitochondrial gets the explanation. Once the organelle is set, the suggestion shows its code, and nothing changes until "Use NC_…", which sets the accession and code.
- **Checked by hand against real NCBI:** for redfoot (50047) it suggests NC_080265.1 with code 2, matching the real profile.

## 2026-11-10: paper lookup in the Mac app

These tests cover the app side:

- **`study.test.ts` (2 tests):** `linkPaper` records the source, approver and time, and logs the link. It never replaces a different DOI or PMID, and refuses an empty link or an unknown paper.
- **`app.test.tsx`, clicked through on the preview platform:** a GenBank-only study gets proposals from the fake Crossref. Nothing is attached by finding them. "Use this link" attaches the DOI, and the saved Study holds its source and the log entry.

Not seen in a running Mac app; covered by these tests and the typecheck only. Crossref was added to the Tauri HTTP allow-list but hasn't been exercised through Tauri.

## 2026-11-10: paper lookup

`packages/acquire/test/lookup.test.ts` (5 tests, with fake services) covers what the lookup promises:

- **Title matching** ignores case, punctuation and markup.
- **Proposals come from both services**, best match first, with their source, retrieval time and the supplement link, and noise is dropped.
- **A refusing service is reported.**
- **Requests are paced** a second apart, one at a time, with a User-Agent that names the tool and holds no email address.
- **Approval** records who and when, and never overwrites an existing DOI or PMID.

Checked by hand: one real request to each service for a redfoot study.

Gap: the Mac app's Study tab doesn't offer lookup or approval yet.

## 2026-11-10: group audit

`packages/core/test/audit.test.ts` (5 tests) covers what the audit promises:

- **p-distance counts unambiguous bases only.**
- **A clean panel raises nothing** and reports each group's spread.
- **It flags** a record closer to another group, a haplotype shared across groups, and a single-record group.
- **Records that don't cover the whole window are left out and counted**, with the window's width and the best coverage.

The CLI was run by hand on the real redfoot panel 0.7.1 (results in the changelog).

## 2026-11-10: curation history

`engine.test.ts` ("curation history", 2 tests) covers what the history promises:

- **Every save is recorded** field by field, with from, to, who and why.
- **A save that changes nothing writes nothing.**
- **History can be read back for one record.**
- **It appends rather than rewrites** when the store can.
- **A damaged line is reported.**

The Mac app's `decide` now saves through `saveCuration`; no UI test covers the wiring, only the typecheck. The CLI's refusal of `--apply` without `--reason` was checked by hand on the real workspace, and nothing was written.

## 2026-11-10: curation sheet

`packages/core/test/curation-sheet.test.ts` (8 tests) covers what the sheet promises:

- **Export** writes every record, decided or not, and never a coordinate.
- **An unchanged sheet round-trips** with no changes.
- **Edits are read back and counted.** A blank cell clears a field, and a missing row or column keeps what was there.
- **Any error refuses the whole sheet**, listing every problem: unknown group, class or use, a bad exclude value, a duplicate, a missing record, an origin-reported record without its source, coordinates in a site or note. A broken quote and a missing record column are refused too.
- **Unknown columns and records are warnings.** A byte-order mark and CRLF line ends are accepted, and formulas are defused and restored.
- **Bulk assign by study** keeps the other fields and doesn't change the original.

`engine.test.ts` covers `loadRunRecords`, including the case where there's no run. The CLI was checked by hand on the real redfoot workspace: an export and re-import changed nothing, and a wrong group was refused with exit code 1.

## 2026-11-10: dataset README and citations

`engine.test.ts` checks that a build writes `README.md`, with groups, limits, how to check a copy and what to cite, and no coordinate-like numbers. `dataset.json` carries `builtWith` and the citations. An edited README fails `verify` like any other file. The schemas were regenerated, and their drift check passes.

## 2026-11-10: sample routing

`engine.test.ts` ("sample routing", 6 tests) covers what routing promises:

- **It suggests the right panel first** and says why the others don't apply: superseded, another marker, a fragment outside every window, a taxon claim the panel isn't for.
- **A suggested panel accepts the sequence, and a refused one refuses it**, because both use the same checks as `testSample`.
- **It ranks** active before candidate, and the newest version first.

The CLI's folder walk and its skipping of unreadable panels were checked by hand on the bio repo's panels: 4 older formats were skipped, and the cytb records and a random sequence routed as expected.

## 2026-11-10: sample reports

`packages/core/test/report.test.ts` (8 tests) covers what the report promises:

- **It names a region only as the region card would.** It uses the card's words, label and caveat, and a candidate panel is labelled exploratory.
- **It explains a refusal.** When no region is named, it says why in plain words, and it still carries the caveat.
- **It carries everything else:** each group's status and reason, the comparisons, coverage, gaps once each, versions and sources.
- **It never shows a position.** A region that looks like coordinates isn't printed, and the report says why.
- **Its tables stay whole** when a reason contains a bar or a line break.

The CLI command is a thin wrapper. It was checked by hand on the 8 saved redfoot results: none crashed, and none printed a coordinate.

## 2026-11-10: published JSON Schemas

The schemas promise three things:

- **They match the types.** `packages/engine/test/schemas.test.ts` reruns `scripts/schemas.mjs --check`, which fails on any drift.
- **They accept real files.** `engine.test.ts` validates everything the engine writes: profile, curation, panel, result, examples and manifest.
- **They refuse bad files.** The same tests refuse another schema version, an unknown field such as `latitude`, a missing field, and an unknown status.

Checked by hand, not in tests: the real redfoot files in the private data repo all validate (profile, curation, panel 0.7.1, its examples and manifest, and 8 saved results). That repo is private, so its files can't be test fixtures here.

## 2026-11-10: panel examples and verify

`examples.json`, `dataset.json` and `verify` (ADR 0006) promise six things, each covered in `packages/engine/test/engine.test.ts` (7 new tests):

- **A build writes both files**, with the expected examples and every file's hash.
- **A faithful copy verifies.**
- **An edited file, a missing file and a broken seal each fail,** with their own codes.
- **A change in answers fails.** An evaluator that answers differently fails every example it changes, naming both answers.
- **Bad inputs are refused:** examples made for another panel, and a folder with no manifest or no examples.
- **A version keeps its examples.** Writing different ones is refused, and choosing them is deterministic.

The two CLI commands are thin wrappers. They were checked by hand on a copy of the real redfoot panel 0.7.1, which verified, and failed after a one-base edit, with exit code 1. Testing their argument parsing would be overkill.

Gap: the Payload plugin and the platform don't run `verify` on import yet. That belongs with the rest of stage 2's format.

## 2026-11-09: the CLI's file store

Closes the CLI gap left by the first audit. The file store moved out of the CLI's entry file into `packages/cli/src/store.ts`, so it can be tested without running a command. `packages/cli/test/store.test.ts` covers writing, reading, appending and new folders. It also tests that a save replaces a file whole, and that a failed write keeps the old file. **Fixed:** when the rename failed, the temporary file was left behind; it's now removed. The test failed before the fix. The rest of the CLI stays a thin wrapper over the tested engine, and testing its argument parsing would be overkill.

## 2026-11-08: first audit

Scope: every package and the desktop app, with the Payload plugin's access rules first, after the cross-site fix in 0.1.0-alpha.3. Coverage numbers weren't collected; this maps promises to tests by reading them.

### Where the promises are

- The science: invariants P1 to P30 in [scientific-invariants.md](architecture/scientific-invariants.md). Each row names its tests, and that table stays the map for them.
- Owner decisions: [decisions.md](architecture/decisions.md).
- The Payload plugin: its README and the comments on its options.

### Payload plugin: access and data (always covered)

| Promise | Test |
| --- | --- |
| Candidates are hidden from readers, and outsiders can't write panels | `plugin.test.ts` panels: hide candidates |
| Activating needs a signed-in person, who is recorded; who and when can't be faked | `plugin.test.ts` panels: record who activated, refuse a faked activator |
| A panel is frozen once active; only allowed status moves | `plugin.test.ts` panels: frozen once active |
| No coordinates in panels or results | `plugin.test.ts` panels: refuse coordinates; `card.test.ts` never show coordinates |
| Results are hidden until approved; viewers can't approve | `plugin.test.ts` results: hidden until approved |
| Anonymous readers get nothing by default | `plugin.test.ts` results: anonymous readers |
| Results can never be edited, and the reviewer and release date can't be faked | `plugin.test.ts` results: never edited, refuses to fake the reviewer |
| The released endpoint runs with the caller's permissions | `plugin.test.ts` released endpoint |
| Shown candidates are visible only where the site allows them | `plugin.test.ts` exploratory candidates |
| A rule that returns a query is never read as "everything" (`either`) | `review.test.ts` either |
| A site's reviewer sees and approves only that site's results; a member sees results only once released | `review.test.ts` reviewers of one site |
| **New:** a result can't be moved to another site, by a reviewer before or after approving, or by a manager | `review.test.ts` can't move a result |
| **New:** reviewers can't make results | `review.test.ts` can't make results |
| **New:** approving in bulk reaches only the reviewer's own site | `review.test.ts` approving in bulk |
| **New:** a site's staff read only that site's samples and sequences; readers can't change them; neither can move to another site | `records.test.ts` shows a site's staff only that site's |
| Samples and sequences are private and can't be edited or deleted | `records.test.ts` keeps samples and sequences private |
| A file must match its SHA-256 and be exactly one usable DNA sequence | `records.test.ts` reading a lab file, refuses a file whose text does not match |
| The same file again changes nothing; one kit can't serve two animals | `records.test.ts` changes nothing, refuses a kit already used |
| The sweep makes only pending results, on the sample's site, and marks refusals with a reason | `records.test.ts` assignWaiting |

### Fixed in this pass

- **A result's site could change after it was made.** The plugin locked a result's links but not the host's tenant field. A Genealogist on site A who was also a member of site B could approve a site-A result and then move it to B, where B's editors would see it. Results, samples and sequences now keep their site (new option `tenantField`, default `tenant`). The tests above failed before the fix and pass after it.

### Science and engine

Covered by the invariants table: P1 to P13 and P16 to P30 name passing tests. Two corrections:

- **P14** (failures stop a run; retries can't duplicate; no silent skips) was marked pending, but `acquire.test.ts` covers it: it throws after retries instead of skipping, fails on a short batch and on a search that stops early, and removes duplicates across pages. The table now names that test.
- **P15** (confidence calibrated before it is shown as a probability) stays pending. Nothing shows a probability; the card and pages say "Nothing here is a probability", and the hold-out reports give counts only.

### Gaps left

- **CLI (`packages/cli`), no tests.** *Closed 2026-11-09 (entry above).* It's a thin wrapper over the engine, which is tested. One part is data safety: its file store writes to a temp file and renames, so a crash can't leave half a file. That should move into the engine or get a small test. It's on the science lead's list and isn't urgent: the desktop app and the platform don't use it.
- **The platform's own checks** (who may submit a lab file, the Genealogist role, the card): these are tested in the platform repo (`tests/int/phylogeny.int.spec.ts`), not here.

### Left out as overkill

- Payload's own internals, such as relationship validation and admin rendering.
- Rerunning the slow suites only for this audit.
