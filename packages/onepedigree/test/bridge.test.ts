import { describe, expect, it } from 'vitest'
import type { PedigreeDocument } from '@extantape/onepedigree-core'
import { checkMaternalLines } from '../src/index.js'

const seq = (c: string) => c.repeat(150)
const doc: PedigreeDocument = { schemaVersion: 1, individuals: [
  { id: 'mum', label: 'Mum' }, { id: 'dad', label: 'Dad' },
  { id: 'kid', label: 'Kid', parentage: { parents: [{ individual: 'mum', role: 'mother' }, { individual: 'dad', role: 'father' }] } },
  { id: 'odd', label: 'Odd', parentage: { parents: [{ individual: 'mum', role: 'mother' }] } },
  { id: 'gap', label: 'Gap', parentage: { parents: [{ individual: 'mum', role: 'mother' }] } },
] }

describe('checkMaternalLines', () => {
  const report = checkMaternalLines(doc, { mum: seq('A'), dad: seq('G'), kid: seq('A'), odd: seq('C'), gap: '-'.repeat(150) })
  it('reports a conflict with the recorded mother', () => {
    expect(report.conflicts.map((c) => c.offspring)).toEqual(['odd'])
    expect(report.conflicts[0]!.message).toMatch(/check the record/)
  })
  it('ignores the father, whose mitochondrial sequence is not expected to match', () => {
    expect(report.conflicts.some((c) => c.mother === 'dad')).toBe(false)
  })
  it('says nothing when too little is shared', () => {
    expect(report.notEvaluable).toEqual([{ mother: 'mum', offspring: 'gap' }])
  })
  it('skips animals without sequences and changes nothing', () => {
    const copy = structuredClone(doc)
    expect(checkMaternalLines(doc, {}).checked).toBe(0)
    expect(doc).toEqual(copy)
  })
})
