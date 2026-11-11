import type { Panel } from '@captiveorigins/onephylogeny-core'
import { RegionMap, type Ecoregions } from '@captiveorigins/onephylogeny-react'
import { useEffect, useState } from 'react'
import type { Platform } from './platform'

/** Checks that a file is the outlines `scripts/ecoregions.mjs` builds, before the map trusts it. */
export function parseEcoregions(text: string): Ecoregions {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("the outlines file isn't valid JSON")
  }
  const fc = data as Partial<Ecoregions> | null
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features) || !fc.features.every((f) => typeof f?.properties?.ECO_ID === 'number')) {
    throw new Error("the outlines file isn't the RESOLVE Ecoregions GeoJSON that scripts/ecoregions.mjs builds")
  }
  return fc as Ecoregions
}

type Outlines = { state: 'loading' } | { state: 'ready'; ecoregions: Ecoregions } | { state: 'failed'; message: string }

/**
 * The region map for a built panel (roadmap stage 5.1; ADR 0008). Only groups the curators tagged with ecoregions are
 * drawn, and the outlines ship inside the app, so nothing is fetched and the large file is read only when a map shows.
 */
export function RegionMapSection({ panel, platform }: { panel: Pick<Panel, 'groups'>; platform: Platform }) {
  const tagged = panel.groups.filter((g) => g.ecoregions?.length)
  const [outlines, setOutlines] = useState<Outlines>({ state: 'loading' })
  const wanted = tagged.length > 0
  useEffect(() => {
    if (!wanted) return
    let live = true
    setOutlines({ state: 'loading' })
    const load = platform.ecoregions
      ? platform.ecoregions()
      : Promise.reject(new Error("this copy of the app doesn't include the outlines"))
    load.then(
      (ecoregions) => { if (live) setOutlines({ state: 'ready', ecoregions }) },
      (e: unknown) => { if (live) setOutlines({ state: 'failed', message: e instanceof Error ? e.message : String(e) }) },
    )
    return () => { live = false }
  }, [platform, wanted])
  return <section aria-label="Region map">
    <h3>Region map</h3>
    {!wanted
      ? <p className="muted">No group in this panel is tagged with an ecoregion yet, so there's no map to draw. The panel's curators add ecoregion tags to its groups.</p>
      : outlines.state === 'loading'
        ? <p className="muted" role="status">Reading the region outlines…</p>
        : outlines.state === 'failed'
          ? <>
            <p className="error" role="alert">The region map can't be drawn: {outlines.message}. Reinstalling the app puts the outlines back.</p>
            <table className="ophy-table"><caption className="muted">The tagged ecoregions, by RESOLVE Ecoregions 2017 ID</caption><thead><tr><th>Group</th><th>Ecoregions</th></tr></thead>
              <tbody>{tagged.map((g) => <tr key={g.id}><th scope="row">{g.label}</th><td>{g.ecoregions!.join(', ')}</td></tr>)}</tbody></table>
          </>
          : <RegionMap panel={panel} ecoregions={outlines.ecoregions} />}
  </section>
}
