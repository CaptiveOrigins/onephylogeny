# Statuses

A result answers three questions separately. Can each group be compared? Do the columns this sample covers separate each pair of groups? Does anything rule a group out? So a result has a status for each group and a state for each pair.

## For each group

| Status | In JSON | What it means |
| --- | --- | --- |
| Consistent | `consistent` | Within the group's own spread of differences, and no decisive sites favor another group. |
| Ruled out within this panel | `excluded_within_panel` | Outside the group's spread, and decisive sites favor another group. Only within this panel: it says nothing about populations the panel doesn't hold. |
| Inconclusive | `inconclusive` | The evidence points both ways: within the spread but decisive sites favor another group, or outside the spread with nothing deciding against it. |
| Couldn't be compared | `not_evaluable` | Too few shared, well-covered columns, too few records there, or no record in the group that can show where it occurs. This is never a ruling-out. |

Each finding carries a `reasonCode` and a sentence saying why, with the numbers: differences against those allowed, columns compared and separating sites covered.

"Spread" is how far the group's own records differ from each other, scaled to the columns compared, plus the panel's stated `tolerance`.

## For each pair of groups

| State | What it means |
| --- | --- |
| `resolved` | Enough decisive sites favor one side, with none for the other. The pair says which it `favors`. |
| `not_resolved` | The columns this sample covers don't separate the two. That's a real answer, not an error: the sample may cover no separating sites, too few, or sites that disagree. |
| `not_evaluable` | One of the two groups couldn't be compared. |

A sample consistent with two groups that it can't separate is not evidence for either one over the other ([scientific invariants](../architecture/scientific-invariants.md), P25). In the [tutorial](../tutorial.md), a 140-base piece is consistent with groups A and B, and the report says it fits no single group.

## Refused samples

Some samples get no result at all. Too few columns line up with the reference, or the sequence is a different gene. Then `result` is `null` and the diagnostics say why. A refusal isn't a finding about any group.

## Outside validated scope

A result can carry statuses and still be outside what the panel was validated for. It then lists why in `outOfValidatedScope`, and the report names no region. The rules are in the [analysis protocol](../architecture/analysis-protocol.md).
