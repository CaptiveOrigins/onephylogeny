import type { HaplotypeNetwork, Panel } from '@captiveorigins/onephylogeny-core'

/** The reference categorical palette, validated for colour blindness, in fixed order. Past its end a group goes gray and keeps its label. */
export const GROUP_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
const OVERFLOW = '#8a8f98'
const colorFor = (panel: Pick<Panel, 'groups'>, id: string) => GROUP_COLORS[panel.groups.findIndex((g) => g.id === id)] ?? OVERFLOW

type Point = { x: number; y: number }

/**
 * A deterministic spring layout: the same network always draws the same way. Edge length follows the number of steps,
 * so distance on the page means something, and nodes repel so labels don't pile up.
 */
export function layoutNetwork(n: Pick<HaplotypeNetwork, 'nodes' | 'edges'>, size = 520): Map<string, Point> {
  const ids = n.nodes.map((x) => x.id)
  const pos = new Map<string, Point>(ids.map((id, i) => [id, { x: size / 2 + (size / 3) * Math.cos((2 * Math.PI * i) / Math.max(ids.length, 1)), y: size / 2 + (size / 3) * Math.sin((2 * Math.PI * i) / Math.max(ids.length, 1)) }]))
  if (ids.length < 2) return new Map(ids.map((id) => [id, { x: size / 2, y: size / 2 }]))
  const unit = size / (2 + Math.sqrt(ids.length) * 2)
  for (let iter = 0; iter < 400; iter++) {
    const cool = 1 - iter / 400
    const force = new Map<string, Point>(ids.map((id) => [id, { x: 0, y: 0 }]))
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = pos.get(ids[i]!)!, b = pos.get(ids[j]!)!
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.max(Math.hypot(dx, dy), 1)
      const push = (unit * unit) / d / d
      force.get(ids[i]!)!.x += dx * push; force.get(ids[i]!)!.y += dy * push
      force.get(ids[j]!)!.x -= dx * push; force.get(ids[j]!)!.y -= dy * push
    }
    for (const e of n.edges) {
      const a = pos.get(e.a)!, b = pos.get(e.b)!
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 1)
      const pull = (d - unit * Math.min(e.steps, 6)) / d / 2
      force.get(e.a)!.x += dx * pull; force.get(e.a)!.y += dy * pull
      force.get(e.b)!.x -= dx * pull; force.get(e.b)!.y -= dy * pull
    }
    for (const id of ids) {
      const p = pos.get(id)!, f = force.get(id)!
      const len = Math.hypot(f.x, f.y) || 1
      const step = Math.min(len, 20 * cool)
      p.x = Math.min(size - 24, Math.max(24, p.x + (f.x / len) * step))
      p.y = Math.min(size - 24, Math.max(24, p.y + (f.y / len) * step))
    }
  }
  return pos
}

/** Scales a layout to fill the frame, keeping `pad` clear on every side so no circle is cut off. */
export function fitLayout(pos: Map<string, Point>, size: number, pad: number): Map<string, Point> {
  const xs = [...pos.values()].map((p) => p.x), ys = [...pos.values()].map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const scale = Math.min((size - 2 * pad) / Math.max(x1 - x0, 1), (size - 2 * pad) / Math.max(y1 - y0, 1))
  const ox = (size - (x1 - x0) * scale) / 2, oy = (size - (y1 - y0) * scale) / 2
  return new Map([...pos].map(([id, p]) => [id, { x: ox + (p.x - x0) * scale, y: oy + (p.y - y0) * scale }]))
}

function Pie({ x, y, r, slices }: { x: number; y: number; r: number; slices: { color: string; value: number }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (slices.length === 1) return <circle cx={x} cy={y} r={r} fill={slices[0]!.color} className="ophy-net-node" />
  let a0 = -Math.PI / 2
  return <g className="ophy-net-node">{slices.map((s, i) => {
    const a1 = a0 + (2 * Math.PI * s.value) / total
    const large = a1 - a0 > Math.PI ? 1 : 0
    const d = `M${x},${y} L${x + r * Math.cos(a0)},${y + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${x + r * Math.cos(a1)},${y + r * Math.sin(a1)} Z`
    a0 = a1
    return <path key={i} d={d} fill={s.color} />
  })}</g>
}

/**
 * A haplotype network for one window. Circle area is proportional to the number of records, slices show their groups,
 * and links are labelled with steps when more than one. A legend names every group, and a table gives the same numbers.
 */
export function HaplotypeNetworkFigure({ network, panel, size = 520 }: { network: HaplotypeNetwork; panel: Pick<Panel, 'groups'>; size?: number }) {
  const label = (id: string) => panel.groups.find((g) => g.id === id)?.label ?? id
  const total = network.nodes.reduce((s, n) => s + n.records.length, 0)
  const radius = (k: number) => 4 + 4 * Math.sqrt(k)
  const biggest = Math.max(0, ...network.nodes.map((n) => radius(n.records.length)))
  const pos = network.nodes.length > 1 ? fitLayout(layoutNetwork(network, size), size, biggest + 6) : layoutNetwork(network, size)
  const groups = panel.groups.filter((g) => network.nodes.some((n) => n.byGroup[g.id]))
  return (
    <figure className="ophy-network">
      <ul className="ophy-legend" aria-label="Groups">{groups.map((g) => <li key={g.id}><span className="ophy-swatch" style={{ background: colorFor(panel, g.id) }} aria-hidden="true" />{g.label}</li>)}</ul>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Haplotype network for window ${network.window}: ${network.nodes.length} haplotypes from ${total} records, ${network.edges.length} links. The table below has the same numbers.`}>
        {network.edges.map((e) => {
          const a = pos.get(e.a)!, b = pos.get(e.b)!
          return <g key={`${e.a}-${e.b}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="ophy-net-edge" />
            {e.steps > 1 && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} className="ophy-net-steps" textAnchor="middle" dy="-3">{e.steps}</text>}
          </g>
        })}
        {network.nodes.map((n) => {
          const p = pos.get(n.id)!
          const slices = Object.entries(n.byGroup).map(([g, value]) => ({ color: colorFor(panel, g), value }))
          return <g key={n.id}>
            <title>{`${n.id}: ${n.records.length} records (${Object.entries(n.byGroup).map(([g, k]) => `${label(g)} ${k}`).join(', ')})`}</title>
            <circle cx={p.x} cy={p.y} r={radius(n.records.length) + 2} className="ophy-net-ring" />
            <Pie x={p.x} y={p.y} r={radius(n.records.length)} slices={slices} />
          </g>
        })}
      </svg>
      <figcaption className="ophy-muted">
        Records covering window {network.window} whole ({network.columns} columns){network.partial ? `; ${network.partial} partial records left out` : ''}. Circle area counts records, not animals or population frequency. Links join the closest haplotypes; numbers are differing sites. This is not a tree.
      </figcaption>
      <details><summary>As a table</summary>
        <table className="ophy-table"><thead><tr><th>Haplotype</th><th>Records</th>{groups.map((g) => <th key={g.id}>{g.label}</th>)}</tr></thead>
          <tbody>{network.nodes.map((n) => <tr key={n.id}><th scope="row">{n.id}</th><td>{n.records.length}</td>{groups.map((g) => <td key={g.id}>{n.byGroup[g.id] ?? 0}</td>)}</tr>)}</tbody></table>
        <table className="ophy-table"><thead><tr><th>Link</th><th>Differing sites</th></tr></thead>
          <tbody>{network.edges.map((e) => <tr key={`${e.a}-${e.b}`}><th scope="row">{e.a} to {e.b}</th><td>{e.steps}</td></tr>)}</tbody></table>
      </details>
    </figure>
  )
}
