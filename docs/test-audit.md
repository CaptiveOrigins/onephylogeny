# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

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

- **CLI (`packages/cli`), no tests.** It's a thin wrapper over the engine, which is tested. One part is data safety: its file store writes to a temp file and renames, so a crash can't leave half a file. That should move into the engine or get a small test. It's on the science lead's list and isn't urgent: the desktop app and the platform don't use it.
- **The platform's own checks** (who may submit a lab file, the Genealogist role, the card): these are tested in the platform repo (`tests/int/phylogeny.int.spec.ts`), not here.

### Left out as overkill

- Payload's own internals, such as relationship validation and admin rendering.
- Rerunning the slow suites only for this audit.
