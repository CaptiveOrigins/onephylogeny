'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { Icon, type IconName } from './icons'
import { TreeFigure } from './index'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

/** Colors written into a downloaded file, which has no page stylesheet to lean on. */
const STANDALONE_STYLE = '<style>.ophy-tree-edge{fill:none;stroke:#91645d;stroke-width:1.2}.ophy-tree-tip{font:11px sans-serif;fill:#1d2330}.ophy-tree-support{font:8.5px sans-serif;fill:#5b6577}.ophy-tree-supported{fill:#1d6b47;font-weight:700}</style>'

/** Makes tree markup open correctly on its own, in a browser or a drawing program. */
export function standaloneSvg(markup: string): string {
  const open = markup.indexOf('>')
  const head = markup.slice(0, open).replace(/\sstyle="[^"]*"/, '')
  return `${head.includes('xmlns=') ? head : head.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')}>${STANDALONE_STYLE}${markup.slice(open + 1)}`
}

function downloadInBrowser(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'tree.svg'
  a.click()
  URL.revokeObjectURL(url)
}

export type TreeCanvasProps = {
  newick: string
  labelFor?: (tip: string) => string
  thresholds?: number[]
  /** CSS height of the canvas. */
  height?: string
  /** Where a saved SVG goes. By default the browser downloads it. */
  onSaveSvg?: (svg: string) => void | Promise<void>
  /** How to print. By default `window.print()`, which does nothing in some Mac web views. */
  onPrint?: () => void | Promise<void>
}

/** The tree on a canvas: drag to pan, Ctrl/⌘ + wheel or pinch to zoom, `+` `-` `0` keys, Fit, Download SVG, Print (chart only). */
export function TreeCanvas({ newick, labelFor, thresholds, height = '32rem', onSaveSvg, onPrint }: TreeCanvasProps) {
  const canvas = useRef<HTMLDivElement>(null)
  const [{ x, y, k }, setCamera] = useState({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ id: number; px: number; py: number } | null>(null)

  const zoomBy = useCallback((factor: number, at?: { x: number; y: number }) => {
    setCamera((c) => {
      const rect = canvas.current?.getBoundingClientRect()
      const ax = at?.x ?? (rect ? rect.width / 2 : 0)
      const ay = at?.y ?? (rect ? rect.height / 2 : 0)
      const nk = clampZoom(c.k * factor)
      return { k: nk, x: ax - ((ax - c.x) * nk) / c.k, y: ay - ((ay - c.y) * nk) / c.k }
    })
  }, [])

  const fit = useCallback(() => {
    setCamera((c) => {
      const el = canvas.current
      const svg = el?.querySelector('svg')
      if (!el || !svg) return { x: 0, y: 0, k: 1 }
      const fullHeight = svg.getBoundingClientRect().height / c.k
      return { x: 0, y: 0, k: fullHeight ? clampZoom(Math.min(1, el.clientHeight / fullHeight)) : 1 }
    })
  }, [])

  // React's wheel listeners are passive, and a passive listener can't stop the page from zooming.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomBy(Math.exp(-e.deltaY / 200), { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [zoomBy])

  useEffect(() => () => document.documentElement.removeAttribute('data-ophy-printing'), [])

  const down = (e: PointerEvent) => {
    if ((e.target as Element).closest('.ophy-floating')) return
    drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    drag.current = { ...d, px: e.clientX, py: e.clientY }
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
  }
  const up = () => {
    drag.current = null
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') zoomBy(1.25)
    else if (e.key === '-') zoomBy(0.8)
    else if (e.key === '0') fit()
    else return
    e.preventDefault()
  }

  const save = () => {
    const svg = canvas.current?.querySelector('svg.ophy-tree')
    if (!svg) return
    const text = standaloneSvg(svg.outerHTML)
    if (onSaveSvg) void onSaveSvg(text)
    else downloadInBrowser(text)
  }
  const print = () => {
    // Only matters under @media print, where it limits the page to this canvas.
    document.documentElement.setAttribute('data-ophy-printing', '')
    if (onPrint) void onPrint()
    else window.print()
  }

  return (
    <div
      ref={canvas}
      className="ophy-canvas"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label="Tree canvas. Drag to pan. Press plus or minus to zoom, and 0 to fit."
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={keys}
    >
      <div className="ophy-canvas-content" style={{ transform: `translate(${x}px, ${y}px) scale(${k})` }}>
        <TreeFigure newick={newick} {...(labelFor ? { labelFor } : {})} {...(thresholds ? { thresholds } : {})} />
      </div>
      <div className="ophy-floating">
        <ToolButton icon="zoomIn" label="Zoom in" onClick={() => zoomBy(1.25)} />
        <ToolButton icon="zoomOut" label="Zoom out" onClick={() => zoomBy(0.8)} />
        <ToolButton icon="fit" label="Fit" onClick={fit} />
        <ToolButton icon="download" label="Download SVG" onClick={save} />
        <ToolButton icon="print" label="Print" onClick={print} />
      </div>
    </div>
  )
}

function ToolButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }): ReactNode {
  return (
    <button type="button" aria-label={label} data-tip={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}
