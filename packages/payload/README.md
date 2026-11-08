# @captiveorigins/payload-plugin-onephylogeny

OnePhylogeny for Payload: immutable reference panels and released results on your own collections, with server-enforced review, safe endpoints and no coordinates.

See the [repository](https://github.com/CaptiveOrigins/onephylogeny) for documentation.

## Samples and sequences

Pass `records` to add `samples` and `sequences`. A lab's file becomes one of each through one call:

```ts
import { registerSequence } from '@captiveorigins/payload-plugin-onephylogeny'

const { sample, sequence, created } = await registerSequence(payload, {
  tenant, animal, kit, lab, file, // your own record IDs; taxon is read from the animal if you leave it out
  sha256,                          // computed by your server from the stored bytes
  text,                            // the file's contents, which must hash to sha256
  marker: 'cytb',
})
```

It refuses, in plain words, a file whose text doesn't match its SHA-256, a file with more or fewer than one sequence, characters that aren't DNA bases, a sequence outside the lengths set for its marker, and an animal with no species. Sending the same file for the same kit again changes nothing (`created: false`). It writes with full access, so check first that the caller may submit results for that kit.

`assignWaiting(payload, { evaluate })` is the sweep. It tests each waiting sequence against the panel for its marker and species, using the `evaluate` function you pass (OnePhylogeny's `testSample` in a Node job), and records a result pending review. A sequence with no panel stays waiting, and one the panel's checks refuse is marked `not-assessable`, with the reason. Results reach readers only after a reviewer approves them.

