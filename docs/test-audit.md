# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

## 2026-11-11: mitogenome panels in the engine

- **Promises (ADR 0009, decisions 1 to 4):** circular, complete records are turned to the reference's start and strand before alignment; a record that can't be turned is excluded with the reason, never guessed; partial records are aligned as they are; a mitogenome panel's windows are the reference's genes unless the profile gives its own; the control region and left-out genes are listed in `notCovered`; a reference with no usable genes fails the build; per-gene frame and stop checks describe records and samples and never change a status; gene (cytb) profiles behave exactly as before.
- **Covered** (`packages/engine/test/mitogenome-golden.test.ts`, 3 tests, made-up records from `scripts/mitogenome-fixture.mjs` replayed in place of NCBI, as the cytb golden test does): seven records turned by different amounts, two of them stored on the other strand, all aligning at over 99% identity; an unrelated circular record refused and excluded; a partial linear record aligned unturned, with its partly covered genes reported; a one-base deletion in COX1 flagged on that gene and kept; 4 extra bases in the control region not flagged; windows equal to the five genes with ND6 on the minus strand; the control region in `notCovered`; the panel sealed, reloaded and its dataset verified; samples carrying `qc.genes`, with a CYTB frameshift making the QC frame rule bad while the group status stays consistent; a reference stripped of its annotation failing with `reference-unannotated`; profile windows used as given. Cytb behaviour: the existing golden and engine tests pass untouched. Engine tests went from 57 to 60, the repo from 457 to 460.
- **Gaps left:** no real mitogenomes (none of the turtles checked has enough public ones from known places, ADR 0009). A record with a genuinely ambiguous start (two equal anchors) is covered only by core's `rotateToReference` tests, not end to end. The missing genetic code path (checks skipped and said) is covered by code reading only. Samples aren't turned, so a whole mitogenome sample must already start where the reference does.
## 2026-11-11: temporary-file cleanup in the Mac store

- **Promise:** a save replaces a file whole and never leaves debris; a failed save says what went wrong.
- **Fixed:** a failed rename in the Mac store (`apps/desktop/src/platform-mac.ts`) left `<file>.tmp` beside the target. A failed write or rename now removes the temporary file and rethrows the original error unchanged, as the CLI store has done since 2026-11-09. Unlike the CLI, a failed removal isn't dropped: the error then says the temporary file couldn't be removed and names it, with the original error as its `cause`. The capabilities now grant `fs:allow-remove`.
- **Covered** (`apps/desktop/test/platform-mac.test.tsx`, 2 new tests, Tauri file calls mocked): a failed rename leaves only the old file and reports the original error; a failed removal is reported along with the original error. Desktop tests went from 26 to 28, the repo from 445 to 447.
- **Gaps left:** the file calls and capability check are mocked, so a real failed save in a built app is unchecked.
## 2026-11-11: outcomes by window, shown

- **Promises:** counts always come with their tests and interval, never as a bare rate; no-test rows say so; warnings are shown; old reports still render.
- **Covered** (`packages/react/test/outcomes.test.tsx`, 3 tests): counts and intervals, "No tests", no bare percentage, a window with no separating columns, study warnings, records without a study, and an empty render for old reports. The Mac app passes the reports through; that wiring is covered by typecheck.
- **Gaps left:** not looked at in the running Mac app yet.

## 2026-11-11: consensus from mapped reads

- **Promises:** no base is written without enough depth and agreement; mixed positions are listed, never resolved; insertions aren't silently added; malformed pileups are refused with the line.
- **Covered** (`packages/core/test/pileup.test.ts`, 7 tests): the mpileup syntax (both strands, read starts and ends, indels, deletions, quality cutoff), refusals, and consensus cases: confident, thin, split, deleted, unlisted, mixed, frequent insertions, outside the reference, and end to end from text.
- **Gaps left:** no real low-pass run yet. Deletions are counted whatever their quality character, as samtools gives it.

## 2026-11-10: stronger validation

- **Promises:** each study and each site is held out in each window and tested against a panel built without it; every test gets exactly one outcome, in the stated order; a study or site whose removal leaves its group below depth is reported as not testable with a reason, never dropped; records without a study are counted, not tested; every window and group is listed, including a window with nothing to test or no separating column; every rate is a count with an exact interval on tests and the method named; results are the same on every run.
- **Covered** (`packages/core/test/validation.test.ts`, 16 tests, made-up panels whose counts follow from how they're built): Clopper-Pearson against R's `binom.test` for 0/10, 5/10, 10/10 and 1/4; all nine branches of the outcome order, including a truth that can't be compared while another group is consistent (wrong); a single-study group and a study whose removal leaves one record (both not testable, with reasons, in rows and totals, with no interval); a study whose labels disagree with the rest (2 of 2 wrong); named-but-not-all-compared when another group falls below depth; a window identical in every group (kept, never named) and an unsequenced window (no tests, no intervals); a site whose removal leaves its group below depth; totals and intervals summed over studies; a repeat run giving identical JSON; `fullValidation` carrying both reports.
- **Gaps left:** not run on real data, so the protocol's stated expectation is untested. The Mac app and React `ValidationView` don't show the new reports yet. The site report doesn't list sites by name, by design, since block names can name places.

## 2026-11-11: joining forward and reverse reads

- **Promises:** a disagreement between two good bases is never resolved by choosing; each read fills the other's gaps; a read that doesn't align is left out and said so.
- **Covered** (`packages/core/test/chromatogram.test.ts`, 2 tests, with the real aligner): an overlapping pair with one planted disagreement (listed, written as N) and one low-quality base filled from the other read, giving the reference back exactly otherwise; one read not aligning; neither aligning.
- **Gaps left:** no real forward and reverse pair from a tortoise yet.
## 2026-11-11: SNPs from a prepared VCF

- **Promises:** genotypes are read exactly; missing calls are never differences; filtered sites are counted; malformed files are refused with the line; nearest-neighbour agreement counts only pairs sharing enough sites.
- **Covered** (`packages/core/test/vcf.test.ts`, 5 tests): reading, missing and filtered sites; four kinds of refusal; distances of 0, one half and none; a made-up two-population set with one animal whose nuclear genotypes sit with the other group's (reported, not hidden), an uncalled animal, an animal only in the groups and one only in the VCF.
- **Gaps left:** no real VCF yet (none is published for the redfoot 3RAD study). Multi-allelic and haploid sites are read but only tested through code reading.

## 2026-11-10: region map in the Mac app

- **Promises:** the Panel tab shows the region map only for a panel whose groups carry ecoregion tags, and otherwise says no group is tagged yet; the map keeps its legend, table and credit line; the outlines come from inside the app, never the network, and are read only when a map shows; a missing, unreadable or wrong outlines file gets a plain reason and no crash.
- **Covered** (`apps/desktop/test/regionmap.test.tsx`, 7 tests, mocked Tauri file system and resource path): no tags gives the note, no map and no read of the outlines; tags and outlines give the map with its accessible name, legend, table (a native disclosure, so it opens from the keyboard) and credit line; missing outlines give an alert and still list the tagged IDs; the browser preview, which has none, says so; the Mac platform reads the bundled file once, refuses a missing, unreadable, non-JSON or wrong-shape file with a reason, and doesn't remember a failure. `app.test.tsx` now checks a real build of the untagged example panel shows the note and no map.
- **Gaps left:** the outlines are made-up squares; the real 8 MB file hasn't been read by the app, and the release workflow's build step hasn't run yet (it runs on the next `desktop-v*` tag). Nobody has seen the map in the running Mac app; that needs a tagged panel, and none is tagged yet.
## 2026-11-10: mitogenome turning and gene checks

- **Promises:** a record is turned to the reference's start exactly, or refused; each protein-coding gene is read on its own strand; frameshifts and internal stops are flagged; partial genes and genes the reference itself can't read cleanly aren't judged.
- **Covered** (`packages/core/test/mitogenome.test.ts`, 4 more tests, 11 in all): the real redfoot reference turned by 5,000 bases, and reverse-complemented and turned, comes back exactly, though its own start is a tandem repeat. A record without the anchor is refused. All 13 genes of the reference pass (ND6 on the minus strand), and a made-up stop, frameshift and 10% gap in COX1 are each flagged.
- **Gaps left:** no real second mitogenome has been turned yet (the next part builds panels from real records). The ambiguous-anchor refusal is covered only through code reading.

## 2026-11-10: mitogenome gene windows

- **Promises:** windows come only from the reference's annotation; anything that can't be placed plainly is left out with a reason; no control region is invented; overlapping genes count once.
- **Covered** (`packages/core/test/mitogenome.test.ts`, 7 tests): the real redfoot reference gives 13, 2 and 22 windows in order with unique ids, ND6 on the minus strand, ND3's two-part annotation kept as one window with a note, and a note that the control region isn't annotated. Made-up records cover each left-out case and same-named tRNAs.
- **Gaps left:** a reference with `complement(join(...))` genes isn't in the fixtures. Nothing uses the windows to build a panel yet.

## 2026-11-10: Sanger chromatograms and primers

- **Promises:** `.ab1` files are read exactly; nothing unreadable is guessed at; low-quality bases become N and are counted; second peaks are flagged without changing calls; primer placement refuses rather than guesses.
- **Covered** (`packages/core/test/chromatogram.test.ts`, 15 tests): bases, qualities and sample names match Biopython's own expected values on two real files (a good 3730 read and a failed 310 read). Not ABIF and cut-short files are refused. Mott trimming, masking, the mixed-peak flag, short and failed reads, and a read with no qualities. Primers in the flanks with an offset, partial coverage with the primer sites left out, degenerate codes, absent, reversed and two-place primers.
- **Gaps left:** the trimming isn't compared base for base with Biopython's `abi-trim` (Biopython isn't installed here). The CLI commands are covered only by typecheck. No tortoise trace has been read yet: the fixtures are Biopython's plasmid and test reads.

## 2026-11-10: full audit

The 14-day full pass, over every package and the Mac app. Promises came from the README, the invariants (P1 to P30), the analysis protocol, the ADRs, the roadmap's "Built" notes and decisions.md. Each was mapped to tests by reading them; no suite was rerun just for the audit. The suites went from 384 tests in 31 files to 389 in 32, all passing.

### Covered

- **No coordinates anywhere shown or shared.** Panels refuse them (`panel.test.ts`, `plugin.test.ts`). Region cards and reports hide a region that looks like a position (`card.test.ts`, `report.test.ts`). Methods text and the dataset README never write a coordinate-like number (`methods.test.ts`, `engine.test.ts`). The record sheet leaves them out unless asked, and the curation sheet never writes them and refuses them in a site or note (`core.test.ts`, `curation-sheet.test.ts`). The schemas refuse a `latitude` field.
- **Sealing, immutability and verify.** P16 and P17 in `engine.test.ts`, `panel.test.ts` and `build.test.ts`; `verify` catches an edited file, a missing file, a broken seal and changed answers; a version can't be overwritten with different content; Payload freezes a panel once active and never lets a result be edited.
- **Atomic writes and crash recovery.** P18 and P19 in `engine.test.ts` (a failure at every write recovers to the same result), and the CLI store in `store.test.ts`.
- **Fail-closed checks.** An empty search fails unless allowed, a panel with no records fails, a short batch fails after retries, any error refuses the whole curation sheet, and the region card stops on any comparison favouring another group. In the Payload plugin, anonymous readers get nothing, candidates are hidden from readers, the released endpoint runs with the caller's permissions, and a reviewer reaches only their own site.
- **Unknown stays unknown.** Provenance starts unknown (P9), no shared sites gives `not_evaluable` and a `null` distance (P4), a NUMT screen never clears a clean record, QC changes no status, paper lookup never overwrites a DOI or PMID, and the schemas refuse a made-up status such as `probably`.

### Gaps added (with the tests)

- **A record's coordinates never reach a published file or a result.** No test fed the engine a record that carried coordinates. `engine.test.ts` now builds a panel with made-up `lat_lon` on one record, checks the run kept it, then checks every file in the panel folder and a sample result for it.
- **The Payload plugin refuses coordinates in a result.** The check existed but wasn't tested. `plugin.test.ts` now tries a coordinate key in a finding and one nested deeper, and checks nothing was saved. The panel test now checks the coordinate message, not just any error.
- **The Mac app's file store.** It had no test. `apps/desktop/test/platform-mac.test.tsx` (3 tests, mocked Tauri file system) checks that a save goes through a temporary file and replaces the old one whole, that a failed write keeps the old file, that logs append, and that nothing is written before a workspace is chosen.

No bugs were found. No source code changed.

### Gaps left

- **A failed rename in the Mac store leaves a `.tmp` file.** The old file stays intact, so nothing is lost. The CLI store had the same leftover and was fixed on 2026-11-09. It's for the lead to decide whether to make the two match; this pass didn't change source code.
- **Climate output.** Nothing is built yet (decisions.md, 2026-11-07). When it is, it needs the same no-coordinate test as reports and methods text.
- **P7's query-frame check and P15's calibration** stay pending, as the invariants table says.
- **Payload and the platform don't run `verify` on import,** as noted on 2026-11-10. That waits for stage 2's format work.
- **The Mac app's `decide` → `saveCuration` wiring** is still covered by the typecheck only. A UI test would be bigger than this pass.

### Left out as overkill

- Payload's internals, the CLI's argument parsing, and the playground app.
- A real-disk test of the Mac store. The mocked one checks the order of writes, which is what keeps a file whole.

## 2026-11-10: region map

- **`react.test.tsx` (2 tests):**
  - tagged ecoregions are shaded by group, with neighbours for context;
  - shared ecoregions are outlined, and far ones aren't drawn;
  - the credit is always shown, and the table lists names;
  - a map with no matching tag says so, and missing tags are named.
- **`methods.test.ts` (1 test):** ecoregion tags must be RESOLVE IDs.
- **Looked at by hand:** a render with the real outlines and illustrative redfoot tags.

## 2026-11-10: haplotype network

- **`packages/core/test/network.test.ts` (4 tests):**
  - steps count unambiguous sites only;
  - identical haplotypes collapse, with counts by group, joined by the fewest steps;
  - every equally short link is kept;
  - partial records are left out and counted, and an unknown window is refused.
- **`react.test.tsx` (2 tests):**
  - the layout is deterministic, and fitted inside the frame;
  - the legend names only groups present, multi-step links are labelled, and the table matches.
- **`app.test.tsx`:** the network appears after a build.
- **Looked at by hand:** a render of the real panel 0.7.1's 3p window. That caught circles cut off at the edge, fixed with `fitLayout`.

## 2026-11-10: chimera candidates

`packages/core/test/audit.test.ts` (2 new tests) covers what the check promises:

- **A record with halves nearest to different groups is flagged**, and its neighbours aren't pulled along with it.
- **Consistent records pass.** Records missing a whole window, and windows where the own group has nothing to compare, are skipped.

Both failure modes were found by these tests while building, and fixed: consensus instead of nearest record, and the own-group rule.

## 2026-11-10: sample QC

- **`packages/core/test/qc.test.ts` (5 tests):**
  - a clean sequence is good;
  - missing data is graded by share of covered columns, with gaps not counted, and mixed sites by count;
  - frame and stops come from the record checks;
  - clusters are measured against the nearest panel record, and spread-out differences aren't clusters;
  - a panel's sealed thresholds win over the defaults.
- **`engine.test.ts` (1 test):** every result carries QC, a mixed site changes no status, and sealed thresholds apply.
- **By hand:** the real panel 0.7.1 still verifies, and its member examples rate good.

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
