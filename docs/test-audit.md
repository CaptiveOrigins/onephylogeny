# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

## 2026-11-11: round connector joins

Owner decision (2026-11-11): "A: round (Recommended)". Brand text and OnePhylogeny's two icon masters only; no package changed, so the workspace count is unchanged. The script tests (`node --test scripts/oneorigin.test.mjs`) gained one.

- **Promises:** the brand text says round joins; the icons draw them, with no corner made of two separate strokes (a join only applies inside one path); each icon's `aria-labelledby` names its own title; the copy in `brand/oneorigin/` matches the source and its lock.
- **Covered** (`scripts/oneorigin.test.mjs`, "this repo"): both icons have one brown connector path with `stroke-linejoin="round"` at the width `tokens.json` gives, built only from M, H and V, with no two strokes ending on the same point; each `aria-labelledby` matches a `<title id>`; `guidelines.md` and `brand.md` say "round joins" and not "square joins". It failed on the old icons (the label, then the shared corner point). The existing test still holds the copy to the lock with no warning.
- **Gaps left:** the PNG master and the Mac app's icon files are made from the SVG by hand (resvg, then `tauri icon`), so nothing checks they match it; they were looked at once. The icon wasn't seen in the Dock, Finder or at 16 px on a real screen. OneTaxonomy's and OnePedigree's icons already draw round and weren't changed or tested here; their brand copies pick up the new text when they next sync.
- **Left out as overkill:** comparing rendered pixels in CI, which would need a renderer as a dependency for one corner.

## 2026-11-11: hypothesis tests in the engine and CLI

Roadmap stage 9, part 2 (ADR 0013). Tests went from 603 to 629 in the workspace: engine 67 to 80 (`packages/engine/test/hypothesis.test.ts`, 13 new), CLI 27 to 40 (`packages/cli/test/hypothesis.test.ts`, 12 new, and 1 in `store.test.ts` for the store's folder listing), and the tutorial test checks two new steps (still 2 tests). The rest are unchanged.

- **Promises:** the engine finds the artifacts a claim needs in the store and loads them with their real file-hash checks, so `filesVerified` is computed and never passed in; it never picks a panel version (with two holding results, or two panels and none named, the claim is untestable; without a folder listing, the claim must name one); `runHypothesis` re-loads and re-checks what the stated test named; a tampered file is `tool or data problem`; nothing is written. The CLI prints the stated test before the verdict, with citations and caveats in plain words; `--plan-only` runs nothing; every verdict exits 0 and only usage mistakes exit non-zero. The tutorial shows a refuted and an untestable claim, and can't drift.
- **Covered:** engine (a workspace the engine builds offline, with two panel versions and saved results, so every hash is real): a false claim refuted, citing the artifact its run recorded and the run id, with no "hashes weren't checked" caveat; a true claim not refuted, not confirmed; refusing to pick between two versions for a sample and for a panel claim; groups-distinct with a named version; changed call across versions (refuted, same statuses); a refused sample untestable, with why; tool or data problem for a panel file changed after the plan, a panel artifact tampered in the store with the published copy intact, a saved result copy that differs from its artifact by a byte, a run with no record, and a result deleted between plan and run; a store without folder listing; a lone panel folder checked against `dataset.json`, ignoring the `artifact.json` that points into another store, and failing when tampered. Every engine test that runs a hypothesis uses a store that records writes, and asserts none. CLI: claims from flags for all four kinds and the usage refusals; the plan and verdict text; the built command on the tutorial's offline data for refuted, not refuted, untestable and tool or data problem (all exit 0), `--plan-only` (no verdict, JSON with only the plan), `--json`, `--dir`, and exit 1 for usage mistakes with nothing on stdout; the disk store's `folders` (sorted, folders only, none for a missing folder). Tutorial: step 11's key lines for both verdicts, checked in the real output and on the page.
- **Gaps left:** `possibly-novel` through the engine is run by hand on the tutorial data (untestable: the panel has 13 within-group distances, below the 20 the rule needs) but has no engine test, since the made-up panel is too small to give a novelty verdict; core's tests cover its verdicts. Not run on a real panel. No Mac app view yet, so nothing to test there.
- **Left out as overkill:** testing every claim kind through the CLI's text again; the engine tests pin the verdicts and the CLI tests pin the format once.

## 2026-11-11: hypothesis tests, deterministic core

Roadmap stage 9, part 1 (ADR 0013). Tests went from 581 to 603 in the workspace: core 317 to 339 (`packages/core/test/hypothesis.test.ts`, 22 new). The rest are unchanged.

- **Promises:** ADR 0013 and roadmap stage 9: the test is stated before it runs, with its function, rule, what each verdict means and the artifacts it reads by key and hash; the verdict is one of the closed list; each verdict cites the artifact, hash, run and finding or pair it rests on; `refuted` for a group only when it is `excluded_within_panel`; `not refuted` for consistent or inconclusive, never "confirmed"; `untestable with this data` for `not_evaluable`, a missing result, panel, group or window, or an ambiguous choice between artifacts; `tool or data problem` when a seal, re-derivation or result check fails, the store reports changed files, or an artifact changed after the test was stated; the novelty claim says it's uncalibrated; nothing is written.
- **Covered** (`hypothesis.test.ts`, on made-up sealed panels whose outcomes follow from how they're built): the roadmap check (a false group claim is `refuted`, citing the excluded finding and the resolved pairs; a claim about a one-record group is `untestable with this data`, citing the `not_evaluable` finding and its reason); every claim kind against every verdict it can give: sample in group (refuted, not refuted when consistent, not refuted and named inconclusive, untestable for no result, wrong version, missing panel and unknown group, and refusing to pick between panel versions), groups distinct (resolvable, `no_fixed_sites`, `not_evaluable`, missing window or group, two panels and none named), changed call (a status change, a group in only one version, all the same, different or missing sequence hashes, the same version twice), possibly novel (beyond and within the threshold with `calibrated: false` and the uncalibrated note, windows that disagree, too few columns, no aligned sequence); tool or data problems (tampered panel sequences, a result edited after the plan, a missing artifact, files the store reports changed, a result missing a group); the caveat when the caller didn't check file hashes; the stated test deep-equal before and after every run; and every claim kind run on deep-frozen artifacts that are byte for byte the same afterwards.
- **Gaps left:** nothing loads artifacts from a real store yet, so the store's file check is only tested as a flag the caller passes; that test belongs with the engine wiring. Not run on any real panel or result. No CLI or app tests, since neither shows it yet.
- **Left out as overkill:** a test per wording of each explanation; the tests pin the verdicts, the citations and the key phrases (uncalibrated, not confirmed, inconclusive) that carry a promise.

## 2026-11-11: OneOrigin brand source

Owner decision (2026-11-11): "A: send it, accept guidelines (Recommended)". Tests went from 580 to 581 in the workspace (desktop 56 to 57, `apps/desktop/test/theme.test.tsx`), plus 19 new script tests run by `node --test scripts/oneorigin.test.mjs` (in CI, not in `pnpm test`).

- **Promises:** `docs/oneorigin/` is the one source, and `brand/oneorigin/` a copy that matches `brand/oneorigin.lock` byte for byte; `check` fails on a hand edit, a missing or added file, or a built CSS file that differs from what `build` writes, and only warns when the source has moved ahead or can't be reached; `lock` refuses a copy that differs from the source, or a source whose `docs/oneorigin/` has uncommitted changes, so the recorded commit really holds what was copied; `build` writes each tool's variables under its own prefix, the same bytes every time; `tokens.json` passes its schema and holds the focus-ring rule (`#a65f20` light, `#e7a066` dark, `#cf8137` accent); the icon parts are the icons' own values; the Mac app's colors didn't change.
- **Covered** (`scripts/oneorigin.test.mjs`, 19 tests on throwaway git repos in the temp folder): the schema (with ajv) and the script's own validation, including refusing a tool color that would replace a shared one, a bad color and a repeated prefix; focus 3:1 and text 4.5:1 on every tool's background and panel in both modes; the built CSS for each prefix (light at `:root`, dark for the system and a chosen Dark, per-tool panel and status colors, unknown prefix refused); a fresh lock passing with the commit, checksums and outputs recorded; a hand edit, a missing file and an added file each failing; a hand-edited or missing CSS file failing and `build` fixing it; no lock failing; the source moving ahead and an unreachable source each giving one warning and no error; `lock` refusing a mismatched copy and a dirty source; the command line's exit codes and GitHub annotations; this repo's copy passing against its own source with no warning; the badge paths and tile gradients matching `brand/icon.svg` and the tokens. `theme.test.tsx` (1 new, 3 changed): the app's shell colors equal the built tokens in light and both dark blocks, no `--ophy-` color is written by hand in `app.css`, and the focus checks now read `--ophy-focus` from the built file.
- **Gaps left:** the download path (a copy checking OnePhylogeny on GitHub) isn't tested, so the tests need no network; it's warn-only, and the offline and missing-source warnings are tested. The built CSS hasn't been looked at in the running Mac app; its values equal the old hand-written ones, which the test checks. The other two tools' copies are checked in their own CI.
- **Left out as overkill:** a test per token value; the schema and the contrast test cover their shape and what matters about them.

## 2026-11-11: focus ring colour

Owner decision (2026-11-11, option A): "keep the brand orange everywhere else, but use the darker orange #a65f20 for focus rings on light backgrounds (4.6 to 1 or better). Dark mode keeps the lighter orange, which already passes." Tests went from 574 to 577: desktop 53 to 56 (`apps/desktop/test/theme.test.tsx`, new). The rest are unchanged.

- **Promises:** `brand/README.md`, "Focus ring": light focus rings are `#a65f20` and pass 3:1 on every light background (WCAG 2.2 1.4.11, 2.4.13); dark rings stay `#e7a066`; the brand orange stays for everything else.
- **Before and after (focus colour on the background it sits on):** light, app controls: `#cf8137` 3.07:1 on the page and fields (`#ffffff`), 2.88:1 on the side panel (`#fbf7f4`); now `#a65f20`, 4.91:1 and 4.61:1. Light, the library's tree canvas (`.ophy-canvas`): 3.07:1 on white, now 4.91:1. Dark, unchanged: `#e7a066` 8.37:1 on the page and fields (`#12151b`), 7.82:1 on the panel (`#181c24`).
- **Covered** (`theme.test.tsx`, 3 tests, computed from the stylesheets): the light `--focus` and `--ophy-focus` are `#a65f20` and the accents are still `#cf8137`; light focus passes 3:1 on the page, panel and fields; both dark blocks (system dark and a chosen Dark) keep `#e7a066` and pass 3:1 on all three; the app's one focus rule uses `var(--focus)` and the library's canvas ring uses `var(--ophy-focus, #a65f20)`.
- **Gaps left:** not looked at in the built app or a browser; the ratios are computed from the CSS. The React package has no dark styles of its own, so a host page in dark mode has to set `--ophy-focus` itself, as the Mac app does; that's said in the stylesheet's comment.
- **Left out as overkill:** a test per focusable control. They all share the one rule the test reads.

## 2026-11-11: distance-based novelty, uncalibrated

- **Promises:** analysis protocol section 8, "Distance-based novelty": per-window thresholds from leave-one-site-out nearest-groupmate distances (95th percentile by nearest rank, at least 20 distances); a query beyond it is `possibly-novel`, at or under it `within-range`, and too few query columns, no record sharing `minSharedColumns`, or too few panel distances is `not-evaluable` with its reason; windows that differ give `windows-disagree`; every answer says `calibrated: false`; nothing changes a result's statuses or `novelty.flagged`; the group-left-out check reports counts with no pass mark.
- **Covered:** `packages/core/test/novelty.test.ts` (13 tests, on made-up panels whose distances are known by construction): nearest-rank percentiles on lists of 19, 20 and 100 values; the threshold and how it was derived; a query inside a group within range (at the threshold, which isn't beyond it); a query 41 of 200 columns from everything possibly novel; each of the three not-evaluable reasons, with the nearest record still reported when only the threshold is missing; windows that disagree; sitemates left out, so duplicate records don't pull the threshold to zero; records without a site counted as one site; the evaluator's result unchanged and carrying no distance field; the group-left-out check coming out possibly novel for distinct groups (30 of 30) and within range for a group that copies another (10 of 10 each way), so it can come out either way.
- **Gaps left:** no calibration, by design, since the data doesn't exist (protocol section 8 says what it needs). The check hasn't run on any real panel, so nothing here says how the rule behaves on real within-group spread. Nothing shows it in the CLI, report or Mac app yet. In the panel tests every within-group distance is equal, so the percentile on a spread of values is covered only by the direct nearest-rank test.

## 2026-11-11: public data listings in the CLI and app

- **Promises:** `onephylogeny sources --taxon NAME_OR_TAXID` and the Study tab's Public data section show what NCBI SRA, NCBI Datasets, GBIF, iDigBio and BOLD list for a taxon, with counts, the query URL and when it was retrieved; flags (or checkboxes) pick sources, all by default; a service that fails is named where its numbers would be and again at the end, never shown as zero, and the command exits 1; the app asks only when its button is pressed and only hosts on its allow-list; both say these are listings and counts, not evidence, and show no coordinates; a Taxonomy ID is named by NCBI Taxonomy before GBIF, iDigBio and BOLD are asked, and if it can't be, they're listed as failed rather than asked about the digits; nothing sent carries an email or key; acquire's existing functions are unchanged.
- **Covered:** `packages/acquire/test/listings.test.ts` (5 tests): every source in order with one retrieval time and a Taxonomy ID named first; `only` asks for nothing else and a name skips NCBI Taxonomy; three failed services named, their slots `null`, the rest still answering; an unnamed Taxonomy ID never sent to GBIF, iDigBio or BOLD; an empty taxon refused before any request. `packages/cli/test/sources.test.ts` (9 tests): flag choice, table alignment, every section's counts, query and retrieval line, the "not evidence, no coordinates" line, failures in place and in the closing list, only the sections asked for, long tables cut at 20 rows with the rest summed; and the built command, offline, needing `--taxon`, exiting 1 on a failed service, and `--json`. `apps/desktop/test/publicdata.test.tsx` (8 tests): no request before the button, the wording, every captioned table and its row and column headers, query and retrieval lines, a failed service in an alert and in place, the keyboard path (native checkboxes in a labelled group, then a submit button, all in tab order, and only the ticked sources asked), no source ticked, no NCBI taxon, "Show all" with `aria-expanded`, and every URL asked matched against the Tauri allow-list. `apps/desktop/test/app.test.tsx` (1 new): the section in the Study tab runs through the app's one-job guard and asks nothing until pressed.
- **Gaps left:** every answer is made up (`fixtures/sources/fake-services.mjs`, shaped like the services as checked by hand earlier today); nothing here ran against a real service, and the app's section hasn't been seen in a running Mac app or through Tauri's HTTP layer. The keyboard path is checked in jsdom (focusable native controls, form submission), not with real key presses or a screen reader. Real pacing (a second between requests) runs in the app and CLI tests, so they each take a few seconds. The `NCBI_API_KEY` path in `sources` isn't tested; `NcbiClient` already covers it and the reported query never carries it (acquire test). Overkill, skipped: re-testing each acquire parser through the CLI and the app.

## 2026-11-11: comparing panel versions on screen

- **What existed:** `compareRuns` in core (records only in one version or moved between groups, every evidence field that changed, settings that differ, claims by change with the gates that moved, post hoc omissions, notes), `comparePanelVersions` in the engine (both versions must match their seals), the CLI's `compare --a V --b V` printing that as JSON, and a short list in the Mac app's Study tab. Against stage 5's check ("a reader can follow one conclusion... without opening a file"), the gaps were: validation outcomes by window (counts and intervals) weren't compared at all; nothing could be read without the app or JSON; the app's list showed claim gates as raw ids and group ids, not labels, with no table captions; the comparison sat only in the Study tab; and none of it was in the React package, so the platform couldn't show it.
- **Promises:** `compareRuns` is unchanged; each version's outcome rows are paired by scheme, window and group with each side's own counts and intervals, never subtracted or combined into a score; a row only one version has is kept and marked; a version without outcome reports is named and read first, as are post hoc omissions and missing claims reports; the Markdown, the React view and the Mac app use the same words (from core); every table has a caption and header cells; unchanged claims are hidden until asked; a comparison on screen always matches the two versions picked; a version can't be compared with itself; a version that fails its seal is refused with nothing shown; the saved Markdown is exactly what the CLI prints; the CLI's JSON is unchanged without `--markdown`.
- **Covered:** `packages/core/test/comparison.test.ts` (9 tests, made-up panels and reports): pairing and `same` per row, a group in one version only, no derived fields, missing reports on either side and on neither; `comparePanels` returning `compareRuns`' result untouched, with labels from both panels; the Markdown's records, regroup table, settings, changed claim with both sides and the moved gate, fields already shown not repeated and others listed, outcome rows with intervals and no bare percentage, warnings first (post hoc omission, missing report, missing outcomes), and a `|` in a record name escaped. `packages/react/test/comparison.test.tsx` (4 tests): labels, captions on every table and no header cell without scope, changed and unchanged claims, outcome rows with intervals or "No tests", post hoc and missing-report notes in order. `packages/engine/test/engine.test.ts` (extended): `panelVersionComparison` gives `comparePanelVersions`' result plus the stored outcome rows of both versions, and refuses a version changed after sealing. `apps/desktop/test/compare.test.tsx` (6 tests, two versions built by the real engine on the preview's made-up records): the two newest picked; the moved record, captioned outcome tables, every outcome cell a count with its interval or "No tests"; changing a version clears the comparison, and the same version twice can't be compared; the unchanged-claims checkbox; Save as Markdown writing exactly `comparisonMarkdown`'s text at the stated path, and Show file revealing it; a tampered version refused with no comparison shown; fewer than two versions. `apps/desktop/test/app.test.tsx`: the existing Study-tab test, reworded to the new text, and 1 new test for the section in the Panel and Study tabs. `packages/cli/test/tutorial.test.ts`: two new steps (`regroup`, `compare`) run against the built CLI, with 14 more key lines checked on the page and in the output. Core tests went from 295 to 304, React from 17 to 21, desktop from 37 to 44, the repo from 509 to 529.
- **Gaps left:** the Mac app's section hasn't been looked at in a running app; the tests use the browser preview's in-memory store, so no Tauri call is made, and Show file's real Finder reveal is mocked. Saving is tested through the preview's store; the Mac store's atomic writes are covered by their own tests. The CLI's JSON output for `compare` isn't run by any test (it's the same object `comparePanelVersions` returns, which the engine test checks). No real panel versions have been compared; the tutorial's two versions come from the golden fixture, and its regrouping is an exercise.
## 2026-11-11: more record sources

- **Promises (roadmap stage 6.2):** `listSraRuns`, `biosampleFor`, `datasetsGenomes`, `occurrenceCoverage` and `boldCoverage` list or count, and never download reads, genomes or occurrence records; no coordinates are returned or kept, and BioSample contacts, owners and SRA submitters are never read; each result carries `source`, `retrieved`, `query` and `requests`, and the query never carries an email or key; a list cut short says so; a refusal is reported once, not retried; a failed service is named, never shown as zero; a name GBIF matches only at a higher rank, or BOLD can't resolve, is refused.
- **Covered** (`packages/acquire/test/sources.test.ts`, 12 tests, made-up responses shaped like the real ones, no network): SRA runs parsed to every field, a run with no bases yet, the submitter's name absent from the output, `experiments.total` against `listed`, only esearch and esummary called, a name searched as `[Organism:exp]`, and no email or key in the reported query when the client has both; BioSample attributes named like coordinates (`lat_lon`, `decimal_latitude`) and values shaped like them (decimal pairs, hemisphere letters, degrees and minutes) dropped and named in `withheld`, with the made-up coordinates, contact name, email and lab absent from the whole output, placeholders such as `missing` left out, missing accessions listed, and a non-BioSample accession refused before any request; coordinate detection on ordinary values (dates, `Brazil: Example State`, ages) giving no false alarm; Datasets read across two pages, a second apart, with the User-Agent, the embedded BioSample's coordinates and names absent, and a 429 reported once with one request made; GBIF counts by country, basis of record and licence with `limit=0` and only the match and search endpoints called, `noCountry` worked out, iDigBio's verbatim countries and `licences: null`; a higher-rank GBIF match refused and a 503 from iDigBio named in `failed`; a fuzzy match noted; BOLD's two requests and a name it can't resolve. Acquire tests went from 27 to 39.
- **Checked live, once each, by hand on 2026-11-11** (a second apart, User-Agent naming the tool, no email): E-utilities SRA esearch and esummary and BioSample esearch and esummary for *Chelonoidis carbonarius* (taxid 50047, 241 SRA experiments); NCBI Datasets v2 genome reports for *Chelonoidis* (3 assemblies); GBIF species match and a `limit=0` facet search (4,507 records, 3 licences); iDigBio's summary endpoint (178 records); BOLD's portal preprocessor and summary (4 records, COI-5P). That run caught one bug the first fixtures hid: SRA's `<Platform>` carries an attribute, so the platform was read as missing. Fixed, and the fixture now has the attribute. No real response is committed.
- **Gaps left:** the E-utilities functions inherit `NcbiClient`'s retries, which retry a 429 a few times with growing waits before giving up, unlike the other services here; that's NCBI's documented advice and is covered by the existing client, so it isn't tested again. Coordinate detection is a pattern, so a coordinate written in an unusual way (words, or UTM without the name) could pass in an allowed attribute such as `geo_loc_name`; the allowlist keeps the attributes few, and the pattern errs towards withholding. Paging past 500 SRA experiments, or past two Datasets pages, isn't exercised with real data. Nothing here is shown in the app or CLI yet.

## 2026-11-11: CLI joins reads and compares SNPs

- **Promises:** `sanger --reverse` joins two usable reads on the panel's reference with `joinReads`; good bases that disagree become N and are listed by reference column, never chosen; the FASTA drops reference gaps and insertions and says so, and reads that don't meet keep their places with N between; one failed, too-short or unaligned read means the other is used alone, and that's said; neither usable is an error with exit status 1; `--reverse` without `--dir` is refused in plain words. `snps` reads CSV or JSON groups to the same map, prints `compareWithGroups` per group with the samples left out on either side, gives the same as JSON with `--json`, never prints a probability, and says "none" rather than a number when no pair shares enough sites. The tutorial shows only real output.
- **Covered:** `packages/cli/test/sanger.test.ts` (7 tests). The join path is `joinPair` in `packages/cli/src/sanger.ts`, which the CLI calls; it's tested with made-up reads judged by the real `assessRead`, against a made-up 600-base reference: an overlapping pair given reverse-complemented, with one good disagreement at column 301 (listed and N) and the exact column counts; reads that don't meet (100 N between them, noted); a 3-column deletion left out and counted; a failed and a too-short read each leaving the other alone, with the note; a read that doesn't align leaving the other alone; refusal when neither is usable or neither aligns. The built CLI: `--reverse` without `--dir`, and `--reverse` with no file, each exit 1 with their message. `packages/cli/test/snps.test.ts` (5 tests): CSV in any column order, quotes, a byte-order mark, CRLF and blank lines, and JSON, read to the same map, including the two fixture files; a CSV without the header, an empty cell, a sample in two groups, a JSON array, a non-text group and broken JSON each refused; the built CLI on `fixtures/tutorial/snps.vcf` printing the table (counts, both group rows, both left-out lists, the no-probability line); CSV and JSON groups giving byte-identical `--json` output; the default `--min-shared 100` giving "none" and 7 without a neighbour; missing `--groups`, `--min-shared 0` and a FASTA given as the VCF each exit 1. `packages/cli/test/tutorial.test.ts`: three new steps (`sanger-pair`, `snps`, `snps-json`) run against the built CLI with 15 more key lines checked on the page and in the output. CLI tests went from 6 to 18, the repo from 496 to 508.
- **Gaps left:** no real forward and reverse pair exists in the repository, so the joined text output and `--json` for a joined pair are covered only through `joinPair`, not by running the CLI on two `.ab1` files; the CLI glue that prints them (notes, the span line, the conflicts line, the FASTA header) is read, not tested. The `sanger --reverse --json` shape, a panel with no reference sequence, and both reads failing through the CLI aren't run (the last is covered by `joinPair`'s refusal test, and was run once by hand with exit status 1). A tie for nearest neighbour goes to the animal earlier in the VCF; that's core's behaviour, stated in the tutorial, not changed here. The SNP fixture is made up and tiny; no real VCF has been run.

## 2026-11-11: mitogenome summary across genes and routing

- **Promises (ADR 0009, decisions 5 and 6):** a result from a gene-window panel lays the genes side by side: genes compared, columns counted once, groups within their spread and nearest in each gene, how many genes each group is nearest in, and the genes that disagree; never a probability or a single score, and no status changes; the report shows it in its own section in plain words; cytb results and reports are unchanged; routing lists every panel that applies, so a whole mitogenome gets its mitogenome panel and a cytb panel, with cytb cut out by `locateMarker`; each suggestion says why (gene found, windows covered, taxon match); a suggested panel accepts the sample; a gene found in two places is refused.
- **Covered:** `packages/core/test/gene-summary.test.ts` (10 tests, made-up windows and findings): counts with ATP8 and ATP6 overlapping, an N not counted; per-gene compared, within-spread and nearest; a tie counted for each group; disagreeing genes matching what `resultConflicts` reports; agreeing genes; no probability, score or total in the output; no summary for windows without `gene`, and non-gene windows ignored; nothing compared; the report's wording, table and section order; no section or key for a cytb result. `packages/engine/test/mitogenome-golden.test.ts` (6 new tests, made-up records from `fixtures/golden/mitogenome.gb`, a mitogenome panel and a cytb panel built from the same records): North's summary (4 of 6 genes, 1,206 columns, all nearest North); a made-up chimera with South's CYTB naming the four genes that disagree while statuses come from the per-window rules; a cytb result with exactly the old keys and no report section; a whole mitogenome routed to both panels with the CYTB place, reasons and taxon claim, and accepted by `testSample` on the cut-out part; a CYTB-length sample routed to the cytb panel as given and to the mitogenome panel for its one gene; CYTB twice in a sample refused by both routing and testing. Cytb unchanged: every existing test passes untouched, and a one-off comparison (not committed) of all 39 cytb results and reports from the golden records, built on `main` and on this branch, was byte-for-byte identical. Core tests went from 284 to 294, engine from 61 to 67, the repo from 478 to 494.
- **Gaps left:** no real mitogenomes (ADR 0009). A whole mitogenome tested against a cytb panel used to be refused for low coverage; it is now tested on the cut-out gene, which is the intended change, and the result says so in its caveats. A sample isn't known to be circular, so a gene across a sample's origin isn't joined up and the panel is refused rather than guessed. The Mac app and CLI show the new fields only through the report and the route JSON; no screen was changed or looked at. tRNA windows (about 70 columns) fall under the default minimum of 100 shared columns, so they're counted in the panel but never compared; that's reported, not changed.
## 2026-11-11: tutorial and concept pages

- **Promises:** every command in `docs/tutorial.md` runs, offline, and prints what the page shows; refusals (a tampered panel, a refused sample's report, a failed trace, an unmatched primer) exit with status 1.
- **Covered** (`packages/cli/test/tutorial.test.ts`, 2 tests): every runnable block on the page is named and known to the test; all 16 run in one shell against the built CLI, with `fixtures/tutorial/offline-ncbi.mjs` loaded for every command so nothing can reach the network; each step's exit status, and 42 key lines that must appear both in the real output and on the page. CLI tests went from 4 to 6, the repo from 478 to 480.
- **Gaps left:** the install block (clone, `pnpm install`, `pnpm build`) isn't run, because it needs the network and CI already does the same. The test runs them under bash. They were also run once by hand under zsh, the macOS default, with the same exit statuses. The concept pages make no runnable claims, so they're checked by reading against the code, not by a test.

## 2026-11-11: gene partitions for mitogenome trees

- **Promises:** every column in exactly one partition; codon positions counted on each gene's own strand; overlaps kept apart; cytb trees unchanged.
- **Covered:** `packages/core/test/mitogenome.test.ts` (4 tests: a made-up layout with an overlap, a minus-strand gene, a tRNA and non-coding columns; window-relative numbering and whole genes; NEXUS ranges; the real redfoot reference covering all 16,639 columns once) and `packages/engine/test/mitogenome-golden.test.ts` (IQ-TREE called with `-p partitions.nex` on a mitogenome run, and without it when `partitions` is `none`; a fake tool runner).
- **Gaps left:** IQ-TREE itself hasn't been run on a partition file here (the tool runner is faked). A partition with very few informative columns may need merging; IQ-TREE's own `-m MFP+MERGE` can do that and is left to the profile's model setting.

## 2026-11-11: mitogenome panels in the engine

- **Promises (ADR 0009, decisions 1 to 4):** circular, complete records are turned to the reference's start and strand before alignment; a record that can't be turned is excluded with the reason, never guessed; partial records are aligned as they are; a mitogenome panel's windows are the reference's genes unless the profile gives its own; the control region and left-out genes are listed in `notCovered`; a reference with no usable genes fails the build; per-gene frame and stop checks describe records and samples and never change a status; gene (cytb) profiles behave exactly as before.
- **Covered** (`packages/engine/test/mitogenome-golden.test.ts`, 3 tests, made-up records from `scripts/mitogenome-fixture.mjs` replayed in place of NCBI, as the cytb golden test does): seven records turned by different amounts, two of them stored on the other strand, all aligning at over 99% identity; an unrelated circular record refused and excluded; a partial linear record aligned unturned, with its partly covered genes reported; a one-base deletion in COX1 flagged on that gene and kept; 4 extra bases in the control region not flagged; windows equal to the five genes with ND6 on the minus strand; the control region in `notCovered`; the panel sealed, reloaded and its dataset verified; samples carrying `qc.genes`, with a CYTB frameshift making the QC frame rule bad while the group status stays consistent; a reference stripped of its annotation failing with `reference-unannotated`; profile windows used as given. Cytb behaviour: the existing golden and engine tests pass untouched. Engine tests went from 57 to 60, the repo from 457 to 460.
- **Gaps left:** no real mitogenomes (none of the turtles checked has enough public ones from known places, ADR 0009). A record with a genuinely ambiguous start (two equal anchors) is covered only by core's `rotateToReference` tests, not end to end. The missing genetic code path (checks skipped and said) is covered by code reading only. Samples aren't turned, so a whole mitogenome sample must already start where the reference does.
## 2026-11-11: .ab1 traces in the Mac app and plugin

- **Promises:** each read's assessment is shown before anything is tested; a failed or too-short read is never tested or stored; two reads are joined against the panel reference with disagreements as N and counted; the joined or single read goes through the ordinary sample test; the plugin stores the kept bases and a summary of the assessment, nothing else from the file, and refuses unreadable, mismatched, failed and short files with nothing stored; a stored trace can't be edited.
- **Covered, Mac app** (`apps/desktop/test/traces.test.tsx`, 7 tests, on Biopython's `3730.ab1` and `310.ab1`): a usable read's status, bases kept, mean quality, masked count, mixed peaks and notes, then its kept bases sent to the test under the file's sample name; a failed read refused and not tested; a file that isn't ABIF refused; two reads joined with one conflict counted and written as N, nothing else changed; a good and a failed read, the good one used alone and the other named; more than two files refused; hidden in the browser preview. `apps/desktop/test/app.test.tsx`, 1 test, through the real engine on the preview's made-up panel: a failed read leaves no result, and a usable one goes through `runSample` and its result is saved. `apps/desktop/test/platform-mac.test.tsx`, 1 test: the chosen files are read as bytes, and nothing chosen gives null.
- **Covered, plugin** (`packages/payload/test/records.test.ts`, 3 tests, in-memory MongoDB): a usable upload stored with its kept bases and summary and locked; a failed read, a FASTA file and a checksum mismatch refused with nothing stored; a short read (the good file with all but 60 qualities set to 0) refused with its numbers. Core: `sha256HexBytes` checked against Node's SHA-256 on the file (1 test).
- **Fixed on the way:** the plugin's edit lock compared group fields as the string "undefined", so a group could change unnoticed. It now compares them by value. The new trace test caught it.
- **Gaps left:** the joined pair is the good read and a copy with one base changed, not a real forward and reverse pair, so the reverse-strand path is covered only by core's `joinReads` tests. The Tauri dialog and file reads are mocked; the app hasn't been tried with real files yet. The fixtures are a plasmid, so no real result was produced in the app test, only the panel's refusal. Desktop tests went from 28 to 37, the plugin's from 37 to 40, core's from 279 to 280, the repo's from 457 to 470.

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
