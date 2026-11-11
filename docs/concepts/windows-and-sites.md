# Windows and sites

Every record is placed on one reference sequence first, so column 312 means the same base in every record. Everything below counts in those columns.

## Windows

A window is a named stretch of the reference that's judged on its own. A profile can name windows, usually where common amplicons fall. If it names none, the whole marker is one window, called `whole`, as in the [tutorial](../tutorial.md).

Windows matter because public records cover different stretches. Two records that share no columns can't be compared, so a short record from one study and a long one from another are compared only where they overlap. A result reports each window separately, and a conflict between windows is reported, not averaged away.

A mitogenome panel's windows are its genes, read from the reference's annotation ([ADR 0009](../architecture/adr/0009-mitogenome-panels.md)).

## Sites

"Site" means two different things, and the output uses both:

- **A sampling site** is a place records were collected. The curation gives each record an opaque label, such as `a-1`. Validation never tests a record against records from its own site, and a group needs records from enough sites before a conflict can rule it out. In the tutorial's panel output, `6 records, 6 sites` means 6 records from 6 sampling sites.
- **A separating site** is a column where two groups differ. In `a / d in whole: 30 sites`, groups A and D differ at 30 columns in the `whole` window. A sample's result says how many of these it covers. Many shared columns but few separating sites establish little.

A separating site belongs to a pair of groups in a named window, so adding a third group can't erase what separates the first two ([scientific invariants](../architecture/scientific-invariants.md), P23).

## Missing data

Gaps and N are never differences. An ambiguity code that could match is counted as unresolved, neither for nor against. A group with no columns shared with the sample is "couldn't be compared", never ruled out ([scientific invariants](../architecture/scientific-invariants.md), P3 and P4).
