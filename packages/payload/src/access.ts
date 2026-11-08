import type { Access, Where } from 'payload'

type Granted = boolean | Where

/**
 * Joins access results with "or". A rule may grant everything (`true`), nothing, or only matching records (a query), and
 * a query is never read as everything: a reviewer of one site sees that site's records, not all of them.
 */
export function either(...grants: (Granted | null | undefined)[]): Granted {
  if (grants.some((g) => g === true)) return true
  const queries = grants.filter((g): g is Where => Boolean(g) && typeof g === 'object')
  return queries.length === 0 ? false : queries.length === 1 ? queries[0]! : { or: queries }
}

/** Access that allows what any of the given rules allows. */
export const anyOf = (...rules: (Access | undefined)[]): Access => async (args) => either(...(await Promise.all(rules.map((r) => (r ? r(args) : false)))) as Granted[])
