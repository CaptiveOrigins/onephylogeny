# Tutorial: from records to a report, offline

This walks through OnePhylogeny's command line on a small example: fetch records, build a panel, check it, test three samples, read a report, check a Sanger trace and a primer pair, then compare SNPs with the groups. After the install it needs no network.

Every output below was captured from running the commands. Long output is trimmed, and each trim says so. Run ids, temporary folders and timestamps will differ on your machine. A test (`packages/cli/test/tutorial.test.ts`) runs every command on this page after the install, and checks the key lines of their output, so the page can't drift from the code.

The example data is not a reference panel and says nothing about any real animal. The records are 15 public GenBank records from `fixtures/golden/records.gb`. The groups A to D are labels made up for this exercise. For what the words mean, see the [concept pages](concepts/README.md).

## 1. Install

You need Node 22 or later, pnpm and git. OnePhylogeny is installed from the repository:

<!-- step: install -->
```sh
git clone https://github.com/CaptiveOrigins/onephylogeny.git
cd onephylogeny
pnpm install
pnpm build
```

Stay in the `onephylogeny` folder for the rest. Then give the command a short name, make an empty workspace, and copy the tutorial's profile and curation into it:

<!-- step: setup -->
```sh
REPO="$PWD"
onephylogeny() { node "$REPO/packages/cli/dist/index.js" "$@"; }
WS="$(mktemp -d)"
PANEL="$WS/profiles/tutorial/panels/tutorial-panel-1"
mkdir -p "$WS/profiles/tutorial"
cp fixtures/tutorial/profile.json fixtures/tutorial/curation.json "$WS/profiles/tutorial/"
```

A workspace is a plain folder. Each profile lives in `profiles/<id>/`, and everything a run makes is written beside it.

- `profile.json` holds every choice: the taxon, the marker (cytb), the reference (`NC_080265.1`), the four groups and the rules for reading results. The rules here are loose because the panel is tiny.
- `curation.json` says which group each record belongs to. 13 of the 15 records are given a group. The reference and one other record aren't.

## 2. Fetch the records

`fetch` normally searches NCBI and downloads what it finds. For the tutorial, `fixtures/tutorial/offline-ncbi.mjs` answers those requests from `fixtures/golden/records.gb` instead, and refuses any other network request. You load it only for this one command:

<!-- step: fetch -->
```sh
NODE_OPTIONS="--import $REPO/fixtures/tutorial/offline-ncbi.mjs" onephylogeny fetch --workspace "$WS" --profile tutorial
```

```text
[search] Searching NCBI
[search] Found 15 records, plus 1 named in the profile
[search] Running
[search] Finished
[fetch] Running
[fetch] 0 records already downloaded, 15 to fetch
[fetch] Fetched 15 of 15
[fetch] Finished
[anchor] Running
[anchor] Reference NC_080265.1: 1144 columns
[anchor] Finished
[gate] Running
[gate] 14 records passed, 1 excluded
[gate] too-few-aligned-columns: 1
[gate] low-query-coverage: 1
[gate] clipped-ends: 13
[gate] Finished
{
  "run": "2026-11-11T10-33-51-116Z-fetch",
  "status": "succeeded",
  "records": 15,
  "passed": 14,
  "folder": "/var/folders/…/profiles/tutorial/runs/2026-11-11T10-33-51-116Z-fetch"
}
```

(The folder path is shortened.)

The reference is cut to its cytb gene, 1,144 bases, and every record is placed on it, so column 1 means the same base in every record. One record, `AY673445.1`, is excluded: it's a different gene, and only a few of its bases line up. It stays in the run's `outcomes.json` with its reason. `clipped-ends` is a note, not a failure: most of these records run a little past the ends of the reference's gene.

Without the `NODE_OPTIONS` line, `fetch` goes to NCBI and finds whatever is there today, so your counts will differ from these.

The curation can also be read as a spreadsheet. Here are its first three lines:

<!-- step: sheet -->
```sh
onephylogeny curation export --workspace "$WS" --profile tutorial | head -n 3
```

```text
record,group,provenance_class,use,site,study,origin_source,exclude,note,organism,length,title
AY673445.1,,,,,,,,,Chelonoidis carbonarius,737,"A novel phylogeny for the family testudinidae based on mitochondrial DNA (ND4, CytB) and morphological data"
FM165591.1,a,wild-documented,,a-1,,,,,Chelonoidis carbonarius,1179,"Red- and yellow-footed tortoises (Geochelone carbonaria, Ch. denticulata) in South American savannahs and forests: Does their phylogeography reflect distinct habitats?"
```

`curation import` reads an edited sheet back. It shows what would change, and saves only with `--apply` and a `--reason`.

## 3. Build the panel

<!-- step: panel -->
```sh
onephylogeny panel --workspace "$WS" --profile tutorial
```

The output is about 1,600 lines. Here's the start, trimmed after the second claim. The rest is the same pattern for the other four pairs, then the full validation report.

```text
[validate] Running
[validate] Finished
[panel] Running
[panel] Finished
{
  "panel": "tutorial-panel",
  "version": "1",
  "checksum": "sha256:0c7e1b6f412a07ba434e259fa80c37c1ce1428910423a588c4499b44e1cfd72d",
  "groups": [
    {
      "id": "a",
      "records": 6,
      "coverage": [
        "whole: 6 records, 6 sites"
      ]
    },
    {
      "id": "b",
      "records": 2,
      "coverage": [
        "whole: 2 records, 2 sites"
      ]
    },
    {
      "id": "c",
      "records": 3,
      "coverage": [
        "whole: 3 records, 3 sites"
      ]
    },
    {
      "id": "d",
      "records": 2,
      "coverage": [
        "whole: 2 records, 2 sites"
      ]
    }
  ],
  "pairs": [
    "a / b in whole: 23 sites",
    "a / c in whole: 23 sites",
    "a / d in whole: 30 sites",
    "b / c in whole: 18 sites",
    "b / d in whole: 30 sites",
    "c / d in whole: 34 sites"
  ],
  "claims": [
    {
      "pair": "a / b",
      "window": "whole",
      "passed": false,
      "gates": [
        "FAIL sites: 6 and 2 sites, and 4 needed for each"
      ]
    },
    {
      "pair": "a / c",
      "window": "whole",
      "passed": false,
      "gates": [
        "FAIL sites: 6 and 3 sites, and 4 needed for each"
      ]
    },
```

How to read it:

- There's one window, `whole`, because the profile names none. A window is a stretch of the reference that's judged on its own.
- `6 records, 6 sites` means group A has 6 records from 6 sampling sites. In `pairs`, "sites" means something else: columns where two groups differ. [Windows and sites](concepts/windows-and-sites.md) explains both.
- Every claim fails validation, because each group needs records from at least 4 sampling sites and only A has them. So further down the output says `"scope": []` and warns `No claim passed validation, so this panel has no validated scope`. The panel is still saved, as a `candidate`, and every result made with it says it's outside validated scope.

The panel is a folder of plain files: `panel.json`, `panel.fasta`, `validation.json`, `diagnostics.json`, `examples.json`, `dataset.json`, `artifact.json` and a `README.md`.

## 4. Check the panel

`verify` checks a panel folder on its own, with no profile or workspace. It checks each file's hash, the panel's seal, and reruns the examples saved with it.

<!-- step: verify -->
```sh
onephylogeny verify --dir "$PANEL"
```

```json
{
  "verified": true,
  "diagnostics": [],
  "checked": {
    "files": 6,
    "examples": 6
  }
}
```

Change one byte in a copy and it fails. Here a made-up record is added to the end of a copy's sequences:

<!-- step: tamper -->
```sh
cp -R "$PANEL" "$WS/copy"
printf '>extra\nACGT\n' >> "$WS/copy/panel.fasta"
onephylogeny verify --dir "$WS/copy"
```

```json
{
  "verified": false,
  "diagnostics": [
    {
      "severity": "error",
      "code": "file-changed",
      "message": "panel.fasta has changed since the dataset was written",
      "path": "panel.fasta"
    },
    {
      "severity": "error",
      "code": "panel-changed",
      "message": "Panel tutorial-panel version 1 doesn't match its seal: The panel's sequences aren't the ones it was sealed with"
    }
  ],
  "checked": {
    "files": 6,
    "examples": 0
  }
}
```

It exits with status 1, so a script can stop on it. A panel that fails its seal can't be loaded to test samples either.

## 5. Test samples

`fixtures/tutorial/samples.fasta` holds three made-up samples, all cut from one public record, `FM165591.1`, so the right answer is known:

- `sample-1`: its first 900 bases.
- `sample-2`: 140 bases from the middle.
- `sample-3`: 80 bases.

`FM165591.1` is one of group A's records, so sample-1 matching group A is expected, not impressive. A real test is an animal whose sequence isn't in the panel.

<!-- step: test -->
```sh
onephylogeny test --workspace "$WS" --profile tutorial --fasta fixtures/tutorial/samples.fasta
```

The output is one JSON result per sample, about 570 lines. Here is the start of sample-1's, trimmed after its first finding, and all of sample-3's:

```text
[sample] Running
[sample] Finished
{
  "result": {
    "schemaVersion": 2,
    "query": "sample-1",
    "querySha256": "sha256:d2b091e3b1e6792d5ae4d70accf5785b3ffe42a91c9b6c6fa01bde4346fb2b11",
    "producedBy": [
      {
        "name": "onephylogeny-engine",
        "version": "0.1.0-alpha.7"
      },
      {
        "name": "alignToReference",
        "version": "2"
      }
    ],
    "panel": {
      "id": "tutorial-panel",
      "version": "1",
      "checksum": "sha256:0c7e1b6f412a07ba434e259fa80c37c1ce1428910423a588c4499b44e1cfd72d"
    },
    "run": "2026-11-11T10-33-53-169Z-sample",
    "overlap": 900,
    "findings": [
      {
        "group": "a",
        "status": "consistent",
        "reasonCode": "within-spread",
        "reason": "Within this group's spread: 0 of 4 allowed over 900 columns in whole; 40 separating sites covered",
```

```text
[sample] Running
[sample] Finished
{
  "result": null,
  "diagnostics": [
    {
      "severity": "error",
      "code": "too-few-aligned-columns",
      "message": "Only 80 columns align to the reference (minimum 100): probably a different gene or a poor fragment"
    }
  ],
  "artifact": {
    "type": "sample-result",
    "key": "sha256:076ba3638f0eb85c4f777924b7eb564883621c05944fe625c819a61914ac1582"
  }
}
```

Sample-3 is refused: `result` is `null` and the diagnostic says why. A refusal is not a finding about any group. Each outcome is also saved under `$WS/profiles/tutorial/results/tutorial-panel-1/`, one file per sample.

## 6. Read the report

`report` turns one saved result into Markdown, with only the panel folder and the result file:

<!-- step: report -->
```sh
onephylogeny report --dir "$PANEL" --result "$WS/profiles/tutorial/results/tutorial-panel-1/sample-1.json"
```

```markdown
# sample-1 against tutorial-panel 1

## Conclusion

This result falls outside what the panel has been validated for, so no region is named.

*A result is a statement about the maternal line, never proof of where an animal was collected.*

## Groups

| Group | Status | Columns compared | Why |
| --- | --- | --- | --- |
| Group A | Consistent | 900 | Within this group's spread: 0 of 4 allowed over 900 columns in whole; 40 separating sites covered |
| Group B | Ruled out within this panel | 900 | Outside this group's spread, and decisive sites favor Group A: 18 of 1 allowed over 900 columns in whole; 41 separating sites covered |
| Group C | Ruled out within this panel | 900 | Outside this group's spread, and decisive sites favor Group A: 20 of 2 allowed over 900 columns in whole; 41 separating sites covered |
| Group D | Ruled out within this panel | 900 | Outside this group's spread, and decisive sites favor Group A: 27 of 2 allowed over 900 columns in whole; 41 separating sites covered |

## Comparisons between groups

| Pair | Outcome |
| --- | --- |
| Group A vs Group B | Favours Group A (decisive-sites) |
| Group A vs Group C | Favours Group A (decisive-sites) |
| Group A vs Group D | Favours Group A (decisive-sites) |
| Group B vs Group C | Not separated by the columns this sequence covers (sites-disagree) |
| Group B vs Group D | Not separated by the columns this sequence covers (sites-disagree) |
| Group C vs Group D | Not separated by the columns this sequence covers (sites-disagree) |

## Coverage

900 columns compared.

## Sequence quality

Overall: good. These describe the sequence and don't change any status.

- missing-data: good. 0 of 900 covered columns are N or ambiguous (0.0%)
- mixed-sites: good. 0 two- or three-base ambiguity codes
- frame: good. No frame-shifting insertion or deletion
- stops: good. No in-frame stop codon, or the frame isn't checked
- clustered-differences: good. 0 clusters of 3+ differences within 30 columns, against the nearest panel record

## Gaps and caveats

- This panel is candidate, not active
- This panel has no validated claims yet
- Rules are configured values and these statuses are not probabilities
- This panel does not cover: Everything: this is a tutorial panel, and its groups are labels for the exercise
- A match means this sequence resembles the records in a group. It doesn't show the animal came from that group's region, because a lineage can reach beyond the places sampled so far

## Versions

- Panel: tutorial-panel 1 (candidate), checksum `sha256:0c7e1b6f412a07ba434e259fa80c37c1ce1428910423a588c4499b44e1cfd72d`
- Sample: sample-1, sequence `sha256:d2b091e3b1e6792d5ae4d70accf5785b3ffe42a91c9b6c6fa01bde4346fb2b11`
- Run: 2026-11-11T10-33-53-169Z-sample
- Software: onephylogeny-engine 0.1.0-alpha.7, alignToReference 2

## Sources

- Vargas-Ramirez,M., Maran,J. and Fritz,U.. Red- and yellow-footed tortoises (Geochelone carbonaria, Ch. denticulata) in South American savannahs and forests: Does their phylogeography reflect distinct habitats?. Unpublished
- Vargas-Ramirez,M., Maran,J. and Fritz,U.. Red- and yellow-footed tortoises (Chelonoidis carbonaria, C. denticulata) in South American savannahs and forests: Do their phylogeographies reflect distinct habitats?. Unpublished
```

Group A is consistent and the other three are ruled out within this panel. Even so, the conclusion names no region: the panel has no validated claims, so the report won't name one. The caveats say the same, and they travel with every result. There are no percentages anywhere. [Why there are no probabilities](concepts/no-probabilities.md) explains why.

Sample-2 is shorter, so it covers fewer of the columns that separate groups. Here is its report, trimmed to the parts that differ:

<!-- step: report-2 -->
```sh
onephylogeny report --dir "$PANEL" --result "$WS/profiles/tutorial/results/tutorial-panel-1/sample-2.json"
```

```markdown
## Conclusion

The sequence fits no single group, so no region can be named.

…

| Group | Status | Columns compared | Why |
| --- | --- | --- | --- |
| Group A | Consistent | 140 | Within this group's spread: 0 of 2 allowed over 140 columns in whole; 3 separating sites covered |
| Group B | Consistent | 140 | Within this group's spread: 1 of 1 allowed over 140 columns in whole; 3 separating sites covered |
| Group C | Inconclusive | 140 | Within this group's spread, yet decisive sites favor Group A: 2 of 2 allowed over 140 columns in whole; 3 separating sites covered |
| Group D | Inconclusive | 140 | Within this group's spread, yet decisive sites favor Group A: 2 of 2 allowed over 140 columns in whole; 3 separating sites covered |

…

| Group A vs Group B | Not separated by the columns this sequence covers (too-few-decisive-sites) |

…

## Conflicting evidence

- More than one group fits this sequence: Group A, Group B.
```

Same record, less sequence, weaker answer. 140 bases cover only 3 of the separating sites, so A and B can't be told apart, and C and D are inconclusive rather than ruled out. [Statuses](concepts/statuses.md) covers each one.

Sample-3 was refused, so it has no report:

<!-- step: report-3 -->
```sh
onephylogeny report --dir "$PANEL" --result "$WS/profiles/tutorial/results/tutorial-panel-1/sample-3.json"
```

```text
This sample was refused, so there is no result to report: Only 80 columns align to the reference (minimum 100): probably a different gene or a poor fragment
```

## 7. Check a Sanger trace

`sanger` reads an ABI chromatogram (`.ab1`). It trims the poor ends by quality, turns bases under Q20 into N, flags strong second peaks and prints the kept read as FASTA. The two traces in `fixtures/abi/` come from Biopython's test suite. Neither is from a tortoise: `3730.ab1` is a good read of a plasmid and `310.ab1` is a failed read.

<!-- step: sanger -->
```sh
onephylogeny sanger --ab1 fixtures/abi/3730.ab1
```

```text
Kept bases 15 to 1090 of 1165 by quality.
10 kept bases below Q20 became N.
1 position has a strong second peak: possibly a mixed sample, a nuclear copy or heteroplasmy. Calls are unchanged.
>226032_C-ME-18_pCAGseqF status=usable kept=15-1090
TTTNGGCAANANNTGAGCTCTATGGCCACAACCATGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCA
TCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGG
```

(Trimmed after two of its 16 sequence lines.) The notes go to stderr and the FASTA to stdout, so `> read.fasta` saves only the read. `--json` prints everything, including where the second peak is. `--min-quality` and `--min-length` change the cutoffs.

The failed read:

<!-- step: sanger-failed -->
```sh
onephylogeny sanger --ab1 fixtures/abi/310.ab1
```

```text
No stretch of the read is above the quality cutoff: the read failed.
fixtures/abi/310.ab1: the read failed, so there is no sequence to use
```

It prints no sequence and exits with status 1.

A kept read can go straight to `test`. This one is a plasmid, not cytb, so the panel refuses it:

<!-- step: test-read -->
```sh
onephylogeny sanger --ab1 fixtures/abi/3730.ab1 > "$WS/read.fasta"
onephylogeny test --workspace "$WS" --profile tutorial --fasta "$WS/read.fasta"
```

```text
Kept bases 15 to 1090 of 1165 by quality.
10 kept bases below Q20 became N.
1 position has a strong second peak: possibly a mixed sample, a nuclear copy or heteroplasmy. Calls are unchanged.
[sample] Running
[sample] Finished
{
  "result": null,
  "diagnostics": [
    {
      "severity": "error",
      "code": "no-reference-match",
      "message": "Shares no seed with the reference, in either orientation: probably a different gene"
    }
  ],
  "artifact": {
    "type": "sample-result",
    "key": "sha256:590e1dbcdecb2cc8b6ed5d856d635972ca9b84ddee7f4f387fe8d2c0afde4361"
  }
}
```

`test` takes one read. To join a forward and a reverse read of one sample first, give the reverse with `--reverse` and the panel with `--dir`: both reads are placed on the panel's reference, a base from either fills a gap in the other, and where two good bases disagree the column becomes N and is listed by its reference column, counting from 1. It's never a choice between them. Bases the reference has no column for (insertions) and gaps inside a read are left out of the FASTA, and the notes say how many. `--json` prints both assessments and the join.

This repository has no real reverse read: neither file in `fixtures/abi/` is the other's partner, so a real join can't be shown here. The join itself is tested on made-up reads in `packages/cli/test/sanger.test.ts`. What can be shown is the rule for a bad pair. If one read failed or is too short, the other is used alone, and that's said:

<!-- step: sanger-pair -->
```sh
onephylogeny sanger --ab1 fixtures/abi/3730.ab1 --reverse fixtures/abi/310.ab1 --dir "$PANEL"
```

```text
Forward (fixtures/abi/3730.ab1): Kept bases 15 to 1090 of 1165 by quality.
Forward (fixtures/abi/3730.ab1): 10 kept bases below Q20 became N.
Forward (fixtures/abi/3730.ab1): 1 position has a strong second peak: possibly a mixed sample, a nuclear copy or heteroplasmy. Calls are unchanged.
Reverse (fixtures/abi/310.ab1): No stretch of the read is above the quality cutoff: the read failed.
fixtures/abi/310.ab1 failed, so only fixtures/abi/3730.ab1 is used, alone and not joined.
>226032_C-ME-18_pCAGseqF status=usable kept=15-1090 alone
TTTNGGCAANANNTGAGCTCTATGGCCACAACCATGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCA
```

(Trimmed after the first sequence line.) A read used alone isn't checked against the reference here; `test` does that, and refuses this one as above. If both reads fail, there's no sequence, and the command exits with status 1. `--reverse` without `--dir` is refused too, because a join needs the panel's reference.

## 8. Check a primer pair

`primers` says which of a panel's windows a primer pair can cover. The pair below is made up for this tutorial from the reference itself, 20 bases near each end of cytb:

<!-- step: primers -->
```sh
onephylogeny primers --dir "$PANEL" --forward ACCTACGAAAAACCCACCCA --reverse ATAAGGATTAGGAGGATGGT
```

```json
{
  "status": "ok",
  "forward": {
    "start": 10,
    "end": 30,
    "mismatches": 0
  },
  "reverse": {
    "start": 1080,
    "end": 1100,
    "mismatches": 0
  },
  "amplicon": {
    "start": 10,
    "end": 1100
  },
  "informative": {
    "start": 30,
    "end": 1080
  },
  "windows": [
    {
      "window": "whole",
      "label": "Whole marker",
      "coverage": "partial",
      "columns": 1050,
      "of": 1144
    }
  ]
}
```

Positions count from 0 on the reference's cytb. The bases under the primers come from the primers, not the animal, so only the 1,050 columns between them are informative. That covers part of the one window.

A primer that matches nowhere is refused, with the reason, and the command exits with status 1:

<!-- step: primers-refused -->
```sh
onephylogeny primers --dir "$PANEL" --forward ACCTACGAAAAACCCACCCA --reverse GGGGGGGGGGCCCCCCCCCC
```

```json
{
  "status": "refused",
  "reason": "The reverse primer matches nowhere in the reference within 3 mismatches. If it sits outside the marker, give a longer reference and the marker's offset.",
  "forward": {
    "status": "found",
    "site": {
      "start": 10,
      "end": 30,
      "mismatches": 0
    }
  },
  "reverse": {
    "status": "absent"
  }
}
```

Most published cytb primers sit just outside the gene. For those, pass a longer stretch of the reference with `--reference FILE.fasta` and say where cytb starts in it with `--offset`.

## 9. Compare SNPs with the groups

`snps` reads genotypes from a VCF you've already called, and compares them with the groups the same animals were given. For each animal it finds its nearest neighbour by SNPs, and asks whether that neighbour is in the same group. For each group it gives the mean genotype distance within the group and to everyone else. The groups file is either CSV with a `sample` and a `group` column, or one JSON object mapping sample to group.

`fixtures/tutorial/snps.vcf` is made up: 8 animals and 13 sites, one of which failed the file's own filter. Animal `b-4` was given group B but carries group A's genotypes, on purpose. `c-1` has no group, and `d-1` is grouped but has no genotypes. Real data has thousands of sites, so the default needs two animals to share 100 called sites before they count as neighbours. This file has 12, so the tutorial lowers that with `--min-shared`:

<!-- step: snps -->
```sh
onephylogeny snps --vcf fixtures/tutorial/snps.vcf --groups fixtures/tutorial/snp-groups.csv --min-shared 10
```

```text
VCF: 8 samples, 12 sites used.
Skipped 1 site: filter not PASS (lowQ).
Compared 7 samples that have both SNPs and a group. Two samples count as neighbours only if they share at least 10 called sites.
Nearest SNP neighbour in the same group: 3 of 7. No neighbour with enough shared sites: 0.

Group  Samples  Nearest in same group  Mean within  Mean between
A      3        1 of 3                 0.306        0.485
B      4        2 of 4                 0.558        0.485

Grouped but not in the VCF: d-1
In the VCF but not grouped: c-1

Distances are the share of differing alleles over the sites both samples have called: 0 is identical, 1 is opposite homozygotes. "none" means no pair shared enough sites to measure.
These are descriptions, not probabilities. A sample whose nearest neighbour is in another group is not an error: maternal lines and nuclear relatedness can differ for real reasons.
```

Only 3 of the 7 have their nearest neighbour in their own group. `b-4` and `a-1` have identical genotypes, so each is the other's nearest, across groups. `a-3` and `b-3`, heterozygous at almost every site, are each other's nearest too. `a-2` is exactly as close to `a-1` as to `b-4`; a tie goes to the animal that comes first in the VCF, here `a-1`, so it counts as its own group. Those mixed pairs pull the two means together. None of this says a group is wrong: maternal lines (the mitochondrial groups) and nuclear relatedness can differ for real reasons, such as males moving between places.

The same with the JSON groups file and `--json`:

<!-- step: snps-json -->
```sh
onephylogeny snps --vcf fixtures/tutorial/snps.vcf --groups fixtures/tutorial/snp-groups.json --min-shared 10 --json
```

```json
{
  "samples": 8,
  "sites": 12,
  "skipped": [
    {
      "reason": "filter not PASS (lowQ)",
      "count": 1
    }
  ],
  "minSharedSites": 10,
  "compared": 7,
  "nearestSameGroup": 3,
  "noNeighbour": 0,
  "perGroup": [
    {
      "group": "A",
      "samples": 3,
      "nearestSameGroup": 1,
      "meanWithin": 0.3055555555555555,
      "meanBetween": 0.485479797979798
    },
```

(Trimmed after the first group.) The means aren't rounded in the JSON.

## 10. Clean up

<!-- step: cleanup -->
```sh
rm -rf "$WS"
```

## What this tutorial leaves out

- **Real NCBI.** Everything above ran offline. On real data, `fetch` takes longer and finds more, and `outgroups` and `lookup` need the network. They aren't shown here.
- **A real pair of Sanger reads.** The repository has no forward and reverse read of one sample, so `sanger --reverse` is shown only with a failed partner.
- **Real SNP data.** The VCF is made up and tiny. Calling a VCF from reads is done outside OnePhylogeny.
- **Trees.** `tree` needs IQ-TREE installed (`onephylogeny doctor` says whether it is), so it isn't part of this offline run.
- **A validated panel.** This one has no validated claims, so no result here can name a region. A real panel needs more records from more sampling sites. The [analysis protocol](architecture/analysis-protocol.md) sets out what validation means.
- **The Mac app.** It runs the same steps with buttons. See the [README](../README.md#install-the-mac-app).
