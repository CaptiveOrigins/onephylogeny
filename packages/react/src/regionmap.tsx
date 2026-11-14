import type { Panel } from '@extantape/onephylogeny-core'

import { GROUP_COLORS } from './network.js'

type Ring = [number, number][]
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
export type EcoregionFeature = { type: 'Feature'; properties: { ECO_ID: number; ECO_NAME: string; BIOME_NAME?: string }; geometry: Geometry | null }
export type Ecoregions = { type: 'FeatureCollection'; features: EcoregionFeature[] }

export const ECOREGIONS_CREDIT = 'Ecoregions: Dinerstein et al. 2017, BioScience 67: 534–545, RESOLVE Ecoregions 2017, CC BY 4.0.'

const polygons = (g: Geometry | null): Ring[][] => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
function bbox(f: EcoregionFeature): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const poly of polygons(f.geometry)) for (const [x, y] of poly[0] ?? []) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0, y0, x1, y1]
}

/**
 * The region map (roadmap stage 5; owner, 2026-11-10; ADR 0008): each group's ecoregions shaded in its colour, with
 * neighbouring ecoregions in gray for context. Whole ecoregions only, from the panel's tags: never a site or a point.
 * The host passes the outlines (`scripts/ecoregions.mjs`); the credit line is always shown.
 */
export function RegionMap({ panel, ecoregions, width = 560 }: { panel: Pick<Panel, 'groups'>; ecoregions: Ecoregions; width?: number }) {
  const owner = new Map<number, string[]>()
  for (const g of panel.groups) for (const id of g.ecoregions ?? []) owner.set(id, [...(owner.get(id) ?? []), g.id])
  const byId = new Map(ecoregions.features.map((f) => [f.properties.ECO_ID, f]))
  const tagged = [...owner.keys()].map((id) => byId.get(id)).filter((f): f is EcoregionFeature => Boolean(f?.geometry))
  const missing = [...owner.keys()].filter((id) => !byId.get(id)?.geometry)
  const groups = panel.groups.filter((g) => g.ecoregions?.length)
  if (!tagged.length) return <p className="ophy-muted">No group is tagged with an ecoregion that these outlines have, so there is no map to draw.</p>
  const boxes = tagged.map(bbox)
  const [bx0, by0, bx1, by1] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
  const mx = Math.max((bx1 - bx0) * 0.12, 1), my = Math.max((by1 - by0) * 0.12, 1)
  const [vx0, vy0, vx1, vy1] = [bx0 - mx, by0 - my, bx1 + mx, by1 + my]
  const k = Math.cos((((vy0 + vy1) / 2) * Math.PI) / 180)
  const scale = width / ((vx1 - vx0) * k)
  const height = Math.round((vy1 - vy0) * scale)
  const project = ([x, y]: [number, number]) => `${((x - vx0) * k * scale).toFixed(1)},${((vy1 - y) * scale).toFixed(1)}`
  const pathOf = (f: EcoregionFeature) => polygons(f.geometry).map((poly) => poly.map((ring) => `M${ring.map(project).join('L')}Z`).join('')).join('')
  const context = ecoregions.features.filter((f) => f.geometry && !owner.has(f.properties.ECO_ID)).filter((f) => { const b = bbox(f); return b[2] >= vx0 && b[0] <= vx1 && b[3] >= vy0 && b[1] <= vy1 })
  const colorOf = (gid: string) => GROUP_COLORS[panel.groups.findIndex((g) => g.id === gid)] ?? '#8a8f98'
  const labelOf = (gid: string) => panel.groups.find((g) => g.id === gid)?.label ?? gid
  return (
    <figure className="ophy-regionmap">
      <ul className="ophy-legend" aria-label="Groups">{groups.map((g) => <li key={g.id}><span className="ophy-swatch" style={{ background: colorOf(g.id) }} aria-hidden="true" />{g.label}</li>)}</ul>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Map of the ecoregions behind ${groups.length} groups: ${groups.map((g) => `${g.label}, ${g.ecoregions!.length} ecoregions`).join('; ')}. The table below lists them.`}>
        {context.map((f) => <path key={f.properties.ECO_ID} d={pathOf(f)} className="ophy-map-context"><title>{f.properties.ECO_NAME}</title></path>)}
        {tagged.map((f) => {
          const gs = owner.get(f.properties.ECO_ID)!
          return <path key={f.properties.ECO_ID} d={pathOf(f)} fill={colorOf(gs[0]!)} className={`ophy-map-region${gs.length > 1 ? ' ophy-map-shared' : ''}`}>
            <title>{`${f.properties.ECO_NAME}: ${gs.map(labelOf).join(' and ')}`}</title>
          </path>
        })}
      </svg>
      <figcaption className="ophy-muted">
        Whole ecoregions tagged by the panel's curators for each group's region; never sampling sites. An ecoregion shared by two groups is outlined in black. A sampled population, not proof of where any animal was collected. {ECOREGIONS_CREDIT}
        {missing.length ? ` Not in these outlines: ${missing.join(', ')}.` : ''}
      </figcaption>
      <details><summary>As a table</summary>
        <table className="ophy-table"><thead><tr><th>Group</th><th>Ecoregions</th></tr></thead>
          <tbody>{groups.map((g) => <tr key={g.id}><th scope="row">{g.label}</th><td>{g.ecoregions!.map((id) => byId.get(id)?.properties.ECO_NAME ?? `ID ${id}`).join('; ')}</td></tr>)}</tbody></table>
      </details>
    </figure>
  )
}
