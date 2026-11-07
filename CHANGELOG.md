# Changelog

## Unreleased

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
