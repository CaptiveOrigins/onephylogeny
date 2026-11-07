import { describe, expect, it } from 'vitest'
import { locateMarker, parseGenBank, reverseComplement } from '../src/index.js'

// mulberry32. A multiplicative generator in doubles loses precision and repeats, which makes "unrelated" sequences related.
function random(n: number, seed: number): string {
  let state = seed * 0x9e3779b1
  let out = ''
  for (let i = 0; i < n; i++) {
    state = (state + 0x6d2b79f5) | 0
    let z = Math.imul(state ^ (state >>> 15), 1 | state)
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z
    out += 'ACGT'[((z ^ (z >>> 14)) >>> 0) % 4]
  }
  return out
}
const marker = random(1000, 1)
const genome = (left: number, right: number, m = marker) => random(left, 2) + m + random(right, 3)
const mutate = (s: string, every: number) => [...s].map((c, i) => (i % every === 0 ? (c === 'A' ? 'C' : 'A') : c)).join('')
const holds = (found: string, what = marker) => found.includes(what)

describe('locateMarker', () => {
  it('cuts out the marker with a small flank, and reports where', () => {
    const r = locateMarker(genome(5000, 9000), marker)
    if (r.status !== 'located') throw new Error(r.status)
    expect(holds(r.sequence)).toBe(true)
    expect(r.sequence.length).toBe(1060)
    expect(r.place).toMatchObject({ start: 4970, end: 6030, strand: '+', wrapsOrigin: false })
  })

  it('handles the reverse strand, and reports forward coordinates', () => {
    const r = locateMarker(reverseComplement(genome(5000, 9000)), marker)
    if (r.status !== 'located') throw new Error(r.status)
    expect(holds(r.sequence)).toBe(true)
    expect(r.place).toMatchObject({ strand: '-', start: 8970, end: 10030 })
  })

  it('joins a marker across the origin only when the record is circular', () => {
    const whole = genome(5000, 9000)
    const cut = 5400 // inside the marker
    const rotated = whole.slice(cut) + whole.slice(0, cut)
    const circular = locateMarker(rotated, marker, { circular: true })
    if (circular.status !== 'located') throw new Error(circular.status)
    expect(holds(circular.sequence)).toBe(true)
    expect(circular.place.wrapsOrigin).toBe(true)
    // Not marked circular, the two pieces look like two places. It refuses rather than join them on a guess.
    expect(locateMarker(rotated, marker).status).toBe('multiple')
  })

  it("doesn't count a marker near the origin twice on a circular record", () => {
    const r = locateMarker(genome(100, 14000), marker, { circular: true })
    expect(r.status).toBe('located')
    if (r.status === 'located') expect(r.place.wrapsOrigin).toBe(false)
  })

  it('finds a diverged copy with insertions', () => {
    const diverged = mutate(marker, 17)
    const withIndel = `${diverged.slice(0, 500)}AAA${diverged.slice(500)}`
    const r = locateMarker(genome(5000, 9000, withIndel), marker)
    if (r.status !== 'located') throw new Error(r.status)
    expect(holds(r.sequence, withIndel)).toBe(true)
  })

  it('refuses to choose between two copies, including one on the other strand', () => {
    const two = `${genome(3000, 3000)}${mutate(marker, 20)}${random(3000, 4)}`
    const r = locateMarker(two, marker)
    expect(r.status).toBe('multiple')
    if (r.status === 'multiple') expect(r.places).toHaveLength(2)
    expect(locateMarker(`${genome(3000, 3000)}${reverseComplement(marker)}`, marker).status).toBe('multiple')
  })

  it("doesn't call a short shared piece a second copy", () => {
    expect(locateMarker(`${genome(3000, 3000)}${marker.slice(0, 80)}${random(2000, 5)}`, marker).status).toBe('located')
  })

  it('calls a copy with a change in every seed absent, rather than guessing', () => {
    // Third-position variation can do this to a distant relative. It's reported as not found, and nothing is cut out.
    expect(locateMarker(genome(5000, 9000, mutate(marker, 9)), marker).status).toBe('absent')
  })

  it('reports absence for unrelated sequence', () => {
    const r = locateMarker(random(16000, 7), marker)
    expect(r.status).toBe('absent')
  })
})

describe('GenBank topology', () => {
  it('reads circular from the LOCUS line, and leaves it absent otherwise', () => {
    const gb = (topology: string) => `LOCUS       X1 12 bp DNA ${topology} VRT 01-JAN-2020\nACCESSION   X1\nVERSION     X1.1\nORIGIN\n        1 acgtacgtac gt\n//\n`
    expect(parseGenBank(gb('circular'))[0]!.circular).toBe(true)
    expect(parseGenBank(gb('linear'))[0]!.circular).toBeUndefined()
  })
})
