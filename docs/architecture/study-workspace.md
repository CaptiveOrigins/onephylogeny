# Study workspace

Design for finding papers, gathering their records and running comparable analyses. Nothing here is built yet. It lives in OnePhylogeny.

## The idea

Search a species or free text and get a list of papers. Expand a paper to read about it and see whether records are linked. Add papers to a **Study**, a saved session. Their records go to an **Ingroup** column and an **Outgroup** column, colored by paper, so you can always see where each record came from.

## Layout

| Column | Holds |
| --- | --- |
| Filters | Species, gene, gene region, year, country and the other filters below |
| Search results | Papers. A row changes subtly once it's in the Study |
| Papers | The papers in this Study |
| Ingroup | Their records of the target species and gene |
| Outgroup | Records used to root and compare |

## Moving things

**`+` moves an item one column right, `−` moves it one column left, and dragging does the same.** All three call one set of rules, so they can't disagree. Each is also reachable by keyboard.

| Action | Result |
| --- | --- |
| `+` on a search result | The paper joins the Study |
| `+` on a Study paper | Its records join Ingroup, and other species go to Outgroup as a proposal |
| `+` on an Ingroup record | Moves to Outgroup, and the move is logged |
| `−` on an Outgroup record | Moves back to Ingroup, and the move is logged |
| `−` on an Ingroup record from a paper | Asks for a reason, then omits it |
| `−` on a Study paper | Removes the paper and all its records, after a confirmation |
| `−` on a hand-added record or your own sample | Removes it, since no paper needs it |

Dragging a record out of Ingroup or Outgroup into Papers is the same as omitting it, and asks for the same reason. The Mac web view can intercept drag events, so the app may need `dragDropEnabled: false` or pointer-based dragging. Check this on the real app.

## Rules

- **A paper stays whole.** Every record from a Study paper is present or omitted, and omitted records stay visible, highlighted but faded.
- **Linked highlighting.** Selecting a paper highlights its records. Selecting a record highlights its paper and every other record from it, in either column.
- **Paper identity.** Each paper has a color and a short label, because colors run out and can be hard to tell apart.
- **Different genes.** Records of another gene are listed under the paper as "not this gene" and don't count as omissions.
- **Shared records.** A record cited by two papers counts once and shows both.
- **Outgroups.** GenBank doesn't label them. Other species in a paper are proposed as "other species in this paper" until someone confirms them. They keep their paper's color.

## Prompts

These are inline, because dialogs don't work in the Mac web view.

1. After the first paper is added, offer to save the Study, with **Autosave as you work** checked by default. Cancel leaves it unsaved and visibly marked.
2. After any paper with linked records is added, offer to add those records.

## Omissions

Omitting always needs a written reason, which is kept. The app records whether the omission came before or after a result was seen. **After-result omissions are labeled post hoc, and results are shown with and without those records.** This can't be turned off, because dropping points that hurt a result is how analyses go wrong.

## Gene region view

A track across reference columns, with one band per Study paper in its color.

- Show or hide each paper, any combination of papers, all or none.
- Overlay shows depth per column, and which columns every selected paper shares.
- Named windows are marked, so a gap between papers is obvious.
- It uses coordinates only and shows no group results.
- A search result gets a small version once its records are fetched and placed, which happens when it's expanded.

## Finding papers

The search merges two lists, because most records have no PubMed link: 3 of 294 in our first species' cache.

1. Papers from PubMed and Europe PMC, by species or free text.
2. Studies built from the titles and authors on GenBank records.

Exact DOI or PMID matches link automatically. Close title matches wait for a person, so records never attach to the wrong paper. Rows separate "no records found" from "the paper says it has none". Unpublished submissions are listed as such.

A record isn't necessarily one animal, since a paper may deposit one sequence per haplotype. Rows show records, and individuals stay unknown until someone reads the paper.

## Filters

Species, gene, gene region, year, country, number of records, records new to this Study, locality detail, wild or seized or captive status where known, open access, raw reads available, retraction or correction notices, and published after a panel was frozen.

## Saving and comparing

- Autosave keeps an append-only history, so a Study can be restored to any point.
- A run freezes the exact Study state it used, so autosave can't change what an old result means.
- Duplicate a Study to run it another way, then compare runs side by side, including which records changed group.
- Every run stays listed, so nobody can present the third attempt as the only one.

## Also planned

- **Balance meter:** how much of the Study comes from one paper.
- **Impact preview:** which groups and regions a paper adds records to, with no results shown.
- **Leave-one-paper-out:** rerun without each paper in turn.
- **Methods export:** the search, inclusions, omissions and citations.
- **Paper notes:** saved with the Study.
- **Search log:** query, date, counts, and what was left out and why.
- **Held-aside papers:** papers published after a panel froze can be kept unseen for a confirmatory test.

## Build order

Evaluator version 2 first, because comparing runs is only as trustworthy as the evaluator behind it. It adds the `study` field the workspace needs. Then search, Study and columns; then the gene region view; then run comparison.

Sources need testing before anyone relies on them: PubMed, Europe PMC, PopSet and BioProject first. ENA and DDBJ mirror GenBank, so they aren't extra evidence.
