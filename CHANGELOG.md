# Changelog

## Unreleased

- CLI: a failed save now removes its temporary file. The file store moved to `src/store.ts` and has its first tests: saves replace a file whole, a failed write keeps the old file, and nothing is left behind.

## 0.1.0-alpha.4

- **Payload, fixes access:** a result's site (the host's tenant field) could change after it was made. Someone who reviews one site and belongs to another could approve a result and then move it, so the other site's people would see it. Results, samples and sequences now keep the site they were made for. The new option `tenantField` names the field (default `tenant`). Tested with made-up reviewers on two sites.
- Tests: a reviewer can't make results, approving in bulk reaches only the reviewer's own site, and samples and sequences are read only by their own site's staff. First test audit in `docs/test-audit.md`.

## 0.1.0-alpha.3

- **Payload, fixes access:** an access rule that returns a query, such as "results on this reviewer's own site", was read as "everything" when it decided who sees pending results, panels, samples and sequences. Rules are now joined with "or" (`either`, `anyOf`, both exported), so a reviewer of one site sees and approves only that site's results. Tested with reviewers on two made-up sites.
- Payload: a result's links (animal, sequence, panel, import run) are checked when it is made and not again on review, since they can't change. A site's reviewer who can't read a private animal can still approve its result.

## 0.1.0-alpha.2

- Payload: optional `samples` and `sequences` collections (`records` option). `registerSequence` records one lab file as a sample and a sequence. It checks the file's text against its SHA-256 and refuses, in plain words, a file that isn't exactly one usable DNA sequence for its marker. One sample per kit; the same file again changes nothing, and a different file for the same kit is a second sequence on the same sample. `assignWaiting` tests waiting sequences against the panel for their marker and species and records results pending review, stamped with the panel's status. Tested with made-up data in an in-memory database.
- The region card uses the owner's confirmed wording: "Closer to the maternal line population sampled in <regions> than those in <others>. Other regions are unsampled or untested. Not proof of where this animal was collected."

## 0.1.0-alpha.1

- Hold-out reports add `byStatus`, how many findings had each status and how many concerned the true group, and `singleMatch`, how often one clear match was right, by tests and by sites, with an interval from 4 sites. No probabilities.
- Invariant P30 and `regionCard`: a result may name the region where the matched group's located records were sampled, and the regions it was found closer than, as a hypothesis about the maternal line. Draft card text, waiting for the owner's exact words: "Closer to the maternal line sampled in <regions> than to those sampled in <others>. Other regions are unsampled or untested. Not proof of where this animal was collected." `<others>` names only groups a validated comparison resolved against the match; a comparison favoring another group, or none resolved, shows nothing. It also shows nothing for an ambiguous, novel or out-of-scope match, or for records assigned by sequence. Regions are names, never coordinates. Public display needs the keeper's opt-in. A `candidate` panel shows regions only if a maintainer chose to show it, and `madeAgainst` keeps a result made against a candidate labeled exploratory. Hosts pass translated text and a `locale`, and region lists read naturally in that language ("A, B and C"). The card also comes back in `parts` (label, match, caveat), so a page can show the label as a badge and the caveat on its own line.
- Payload: panels gain `shownAsExploratory`, which only a candidate can have and which clears when it moves on. The new option `resultsAgainst: 'activeOrShown'` lets results be made against such candidates, and lets readers see them; the default stays `active`. Results stamp `panelStatus` and `panelShownAsExploratory` when made, and neither can change.
- **Payload, breaking for scripts that activate panels:** activating a panel needs a signed-in user, and the panel records who (`activatedBy`, their user ID) and when (`activatedAt`). Both are read-only and can't be set or changed any other way. A script without a user can still create candidates, but a person activates them. This records who pressed Activate, not who reviewed the panel's science.

## Mac app 0.2.0

The Mac app ships everything in this section. The npm packages aren't published yet.

- The Mac app no longer offers update checks. Releases have no signing key yet, so there is nothing to check; download the new DMG instead. Signed updates can return in a later release.
- A long record that doesn't annotate the marker, such as a whole mitochondrial genome, now has it cut out by similarity and then goes through the usual checks. It's refused if the marker looks present in more than one place. A record that was left whole used to skip the coverage check.
- Compare any two built panel versions in the Study tab, or with `onephylogeny compare --a V --b V`: records, groups, every evidence field, settings and full claim reports. It reports differences and never recommends a version.
- Duplicate a Study. A copy keeps the runs it came from, so later omissions in it are still labeled post hoc.
- Studies with post hoc omissions offer a copy with them restored, and panels seal the Study state they came from, including those omissions.
- **Breaking for panels:** panels now seal their record checks and a hash of their sequences. Earlier panels load as outdated and need a new version.
- Records assigned by their own sequence no longer shape a group's sites, spread, findings or validation. One such record could previously erase a fixed site and turn an exclusion into `consistent`.
- New provenance class `origin-reported`, which must name its source.
- Loading a panel verifies its seal, and a changed panel is refused.
- Unannotated records now get the coverage check unless they're many times the reference's length.
- New error `terminal-discordance` for foreign tails. Frame-shifting indels and in-frame stops now exclude records from panels, and still warn on samples.
- Analysis protocol: all results so far are exploratory, and rules are fixed before tests.
- NUMT screen (`scripts/numt-screen.mjs`): searches a related genome for nuclear copies of a marker and flags records closer to a copy than to the reference. It runs outside the app and needs BLAST+.
- **Breaking for panels and results:** schema version 2. Evaluation compares groups in pairs, within named windows. Earlier panels load as outdated.
- Results report `pairs` (`resolved`, `not_resolved` or `not_evaluable`), `candidatesNotEvaluated`, `novelty` and `outOfValidatedScope`. `novel_or_unsampled_flag` is gone from findings.
- `rules` replace `thresholds`: shared columns, records per column, sampling sites to rule a group out, decisive sites and tolerance. Windows can be set in the Panel tab.
- Group spread is per window and scales with the columns compared. `compatibility` now requires its minimum overlap.
- Loading a panel derives its sites again and refuses a mismatch.
- Validation harness: claims per pair and window, tested for sites, wrong answers, an exact interval on sites, agreement across studies, shuffled labels, a no-structure simulation and a minimum length. See `fullValidation`.
- **Breaking for profiles:** written `validatedScope` is ignored. Panels gain `claims`, and Payload refuses to activate a panel with no validated claims.
- Hold-out reports add record, haplotype and study schemes, and every row reports sites beside records.
- Mac app: a crash in a tab now shows the error instead of a blank window, and other failures appear in the error banner. Long panel builds show elapsed time beside the button, and opening a profile says it's loading. The clock keeps counting across tabs, only one job runs at a time, and setting provenance for a study shows what it's doing and what's now set.
- React: `ClaimsView`, and `ValidationView` shows the ladder and claims.
- React: `PairTable`, and the panel and validation views show pairs, records still needed and the stricter "all others compared" count.
- React: `TreeCanvas`, with pan, zoom, Fit, Download SVG and Print, plus the suite's shared `icons`. `TreeFigure` stays server-renderable.
- Mac app: the tree uses the canvas. Download saves `tree.svg` to the profile's exports, and Print opens the system dialog.
- Playground: every view on invented data (`apps/playground`).
- Release workflow for npm, not used yet.

## Mac app 0.1.1

- Inline forms replace dialogs that don't work in the Mac web view. Leaving a record out requires a reason.
- Sealed panels, typed artifacts, resumable steps, Cancel and run records for every kind of work.
