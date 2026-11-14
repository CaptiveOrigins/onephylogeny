# @extantape/payload-plugin-onephylogeny

OnePhylogeny for Payload: immutable reference panels and released results on your own collections, with server-enforced review, safe endpoints and no coordinates.

See the [repository](https://github.com/ExtantApe/OnePhylogeny) for documentation.

## Samples and sequences

Pass `records` to add `samples` and `sequences`. A lab's file becomes one of each through one call:

```ts
import { registerSequence } from '@extantape/payload-plugin-onephylogeny'

const { sample, sequence, created } = await registerSequence(payload, {
  tenant, animal, kit, lab, file, // your own record IDs; taxon is read from the animal if you leave it out
  sha256,                          // computed by your server from the stored bytes
  text,                            // the file's contents, which must hash to sha256
  marker: 'cytb',
})
```

It refuses, in plain words, a file whose text doesn't match its SHA-256, a file with more or fewer than one sequence, characters that aren't DNA bases, a sequence outside the lengths set for its marker, and an animal with no species. Sending the same file for the same kit again changes nothing (`created: false`). It writes with full access, so check first that the caller may submit results for that kit.

A Sanger chromatogram goes in the same way, with its bytes instead of text:

```ts
import { registerTrace } from '@extantape/payload-plugin-onephylogeny'

const { sequence } = await registerTrace(payload, { tenant, animal, kit, lab, file, sha256, bytes, fileName: 'K0001-F.ab1', marker: 'cytb' })
```

The read is trimmed by quality and bases below Q20 become N (OnePhylogeny's `assessRead`, with its stated defaults). The kept bases are stored and tested like any sequence. The sequence's `trace` field records how the read was judged: status, kept range, raw length, mean quality, masked bases and mixed-peak count. Nothing else from the file is stored. A file that isn't a chromatogram, doesn't match its SHA-256, or holds a failed or too-short read (under 100 good bases) is refused, and nothing is stored. Joining a forward and a reverse read isn't offered here yet; send the better read.

`assignWaiting(payload, { evaluate })` is the sweep. It tests each waiting sequence against the panel for its marker and species, using the `evaluate` function you pass (OnePhylogeny's `testSample` in a Node job), and records a result pending review. A sequence with no panel stays waiting, and one the panel's checks refuse is marked `not-assessable`, with the reason. Results reach readers only after a reviewer approves them.

On a multi-site host, set `tenantField` if the site field isn't called `tenant`. A result, sample or sequence keeps the site it was made for, so nobody can move it to another site's readers.

