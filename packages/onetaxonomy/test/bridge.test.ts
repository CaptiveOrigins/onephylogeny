import { describe, expect, it } from 'vitest'
import { indexPhylogeny, isMonophyletic } from '@extantape/onetaxonomy-core'
import { treeToPhylogeny } from '../src/index.js'

const base = { id: 't', title: 'T', version: '1', sources: ['s'], rooted: true }
const newick = '((a:1,b:1)95.1/96:1,(c:1,d:1)80/70:1,out:2);'

describe('treeToPhylogeny', () => {
  const p = treeToPhylogeny(newick, { ...base, supportMethods: ['SH-aLRT', 'UFBoot'], lengthUnit: 'substitutions-per-site' })
  it('keeps every support value, with its method', () => {
    const n = p.nodes.find((x) => x.support?.value === 95.1) as (typeof p.nodes)[number] & { additionalSupport?: unknown }
    expect(n.support).toEqual({ value: 95.1, method: 'SH-aLRT' })
    expect(n.additionalSupport).toEqual([{ value: 96, method: 'UFBoot' }])
    expect(n.label).toBeUndefined()
  })
  it('works with OneTaxonomy monophyly checks', () => {
    const idOf = (l: string) => p.nodes.find((n) => n.label === l)!.id
    const index = indexPhylogeny(p)
    expect(isMonophyletic(index, [idOf('a'), idOf('b')]).status).toBe('monophyletic')
    expect(isMonophyletic(index, [idOf('a'), idOf('c')]).status).toBe('not-monophyletic')
  })
  it('never makes tip names into support, and maps concepts only explicitly', () => {
    const q = treeToPhylogeny('((1:1,2:1)90:1,c:1);', { ...base, conceptsForTip: (t) => (t === 'c' ? ['concept-c'] : undefined) })
    expect(q.nodes.filter((n) => n.label).map((n) => n.label).sort()).toEqual(['1', '2', 'c'])
    expect(q.nodes.find((n) => n.label === 'c')!.concepts).toEqual(['concept-c'])
    expect(q.nodes.find((n) => n.label === '1')!.concepts).toBeUndefined()
  })
  it('leaves labels alone when they do not match the named methods', () => {
    const q = treeToPhylogeny('((a:1,b:1)90/80/70:1,c:1);', { ...base, supportMethods: ['x', 'y'] })
    expect(q.nodes.some((n) => n.label === '90/80/70')).toBe(true)
  })
})
