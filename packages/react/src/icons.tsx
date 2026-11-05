import type { SVGProps } from 'react'

/**
 * The OneOrigin suite's line icons (brand/README.md), the same in OnePedigree, OneTaxonomy and
 * OnePhylogeny: drawings from Lucide (https://lucide.dev, ISC license, © Lucide
 * Contributors), the set Captive Origins already uses, flattened to one path each.
 * 24 × 24, 1.75 stroke, round caps and joins, currentColor. Decorative by default
 * (aria-hidden): put the words in the button's text, or in aria-label plus a
 * visible tooltip (`data-tip`) when the icon stands alone.
 */
export const ICON_PATHS = {
  /** lucide: plus */
  plus: 'M5 12h14M12 5v14',
  /** lucide: minus */
  minus: 'M5 12h14',
  /** lucide: zoom-in */
  zoomIn: 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M21 21L16.65 16.65M11 8L11 14M8 11L14 11',
  /** lucide: zoom-out */
  zoomOut: 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M21 21L16.65 16.65M8 11L14 11',
  /** lucide: scan */
  fit: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2',
  /** lucide: download */
  download: 'M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m7 10 5 5 5-5',
  /** lucide: printer */
  print: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6M7 14h10a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1Z',
  /** lucide: undo-2 */
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11',
  /** lucide: redo-2 */
  redo: 'm15 14 5-5-5-5M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13',
  /** lucide: chevrons-up-down */
  expand: 'm7 15 5 5 5-5m7 9 5-5 5 5',
  /** lucide: chevrons-down-up */
  collapse: 'm7 20 5-5 5 5m7 4 5 5 5-5',
  /** lucide: arrow-down-up */
  flip: 'm3 16 4 4 4-4M7 20V4m21 8-4-4-4 4M17 4v16',
  /** lucide: focus */
  focus: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2',
  /** lucide: expand */
  unfocus: 'm15 15 6 6m15 9 6-6M21 16v5h-5M21 8V3h-5M3 16v5h5m3 21 6-6M3 8V3h5M9 9 3 3',
  /** lucide: network */
  layout: 'M17 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1ZM3 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1ZM10 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1ZM5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8',
  /** lucide: funnel */
  filter: 'M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z',
  /** lucide: palette */
  palette: 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8zM13 6.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0M17 10.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0M6 12.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0M8 7.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0',
  /** lucide: x */
  close: 'M18 6 6 18m6 6 12 12',
  /** lucide: external-link */
  open: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  /** lucide: grip-vertical */
  grip: 'M8 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M8 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M8 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M14 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M14 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M14 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  /** lucide: info */
  info: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 16v-4M12 8h.01',
  /** lucide: check */
  check: 'M20 6 9 17l-5-5',
  /** lucide: percent */
  support: 'M19 5L5 19M4 6.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M15 17.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0',
  /** lucide: bone */
  fossil: 'M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z',
  /** lucide: image */
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2ZM7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21',
  /** lucide: file-json */
  file: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1',
  /** lucide: book-open */
  book: 'M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
  /** lucide: chevron-left */
  previous: 'm15 18-6-6 6-6',
  /** lucide: chevron-right */
  next: 'm9 18 6-6-6-6',
  /** lucide: dna */
  dna: 'm10 16 1.5 1.5m14 8-1.5-1.5M15 2c-1.798 1.998-2.518 3.995-2.807 5.993m16.5 10.5 1 1m17 6-2.891-2.891M2 15c6.667-6 13.333 0 20-6m20 9 .891.891M3.109 14.109 4 15m6.5 12.5 1 1m7 18 2.891 2.891M9 22c1.798-1.998 2.518-3.995 2.807-5.993',
} as const

export type IconName = keyof typeof ICON_PATHS

export function Icon({ name, size = 16, className, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={["ophy-icon", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}
