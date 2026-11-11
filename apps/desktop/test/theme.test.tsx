// Focus ring colour, owner decision N154 (2026-11-11, brand/README.md): the darker orange #a65f20 on light backgrounds,
// the lighter #e7a066 in dark mode, the brand orange #cf8137 everywhere else. Contrast is computed from the stylesheets;
// nothing here was looked at in the built app.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(resolve(__dirname, '../src/app.css'), 'utf8')
// Built from brand/oneorigin/tokens.json by `node scripts/oneorigin.mjs build`; CI's `check` keeps it current.
const tokenCss = readFileSync(resolve(__dirname, '../src/oneorigin.css'), 'utf8')
const libraryCss = readFileSync(resolve(__dirname, '../../../packages/react/src/styles.css'), 'utf8')

/** WCAG 2.2 relative luminance and contrast ratio. */
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
const vars = (text: string) => Object.fromEntries([...text.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]))
const block = (start: string, css = appCss) => {
  const at = css.indexOf(start)
  expect(at, start).toBeGreaterThanOrEqual(0)
  return vars(css.slice(at, css.indexOf('}', at)))
}

describe('focus ring colour (N154)', () => {
  const light = block(':root {')
  const darks = [block(':root:not('), block(":root[data-appearance='dark'] {")]
  const tokenLight = block(':root {', tokenCss)
  const tokenDarks = [block(':root:not(', tokenCss), block(":root[data-appearance='dark'] {", tokenCss)]

  it('is the darker orange in light, 3:1 or better on every light background, and the accent stays the brand orange', () => {
    expect(light['--focus']).toBe('#a65f20')
    expect(tokenLight['--ophy-focus']).toBe('#a65f20')
    expect(light['--accent']).toBe('#cf8137')
    expect(tokenLight['--ophy-accent']).toBe('#cf8137')
    for (const bg of ['--bg', '--panel', '--field']) expect(contrast(light['--focus']!, light[bg]!), `focus on ${bg}`).toBeGreaterThanOrEqual(3)
  })

  it('stays the lighter orange in dark, 3:1 or better on every dark background', () => {
    for (const dark of tokenDarks) expect(dark['--ophy-focus']).toBe('#e7a066')
    for (const dark of darks) {
      expect(dark['--focus']).toBe('#e7a066')
      for (const bg of ['--bg', '--panel', '--field']) expect(contrast(dark['--focus']!, dark[bg]!), `focus on ${bg}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('the shell colors match the OneOrigin tokens in light and both dark blocks, and no --ophy- color is written by hand', () => {
    const shell: Record<string, string> = { '--bg': '--ophy-background', '--panel': '--ophy-panel', '--text': '--ophy-text', '--muted': '--ophy-muted', '--border': '--ophy-border', '--accent': '--ophy-accent', '--focus': '--ophy-focus' }
    const pairs: [Record<string, string>, Record<string, string>][] = [[light, tokenLight], [darks[0]!, tokenDarks[0]!], [darks[1]!, tokenDarks[1]!]]
    for (const [app, tokens] of pairs) for (const [name, token] of Object.entries(shell)) expect(app[name], `${name} = ${token}`).toBe(tokens[token])
    expect(Object.keys(vars(appCss)).filter((n) => n.startsWith('--ophy-'))).toEqual([])
    expect(appCss).toContain('--ophy-ink: var(--ophy-mauve); --ophy-flag: var(--ophy-error);')
  })

  it('every focus ring uses the focus variable, and the library falls back to the darker orange', () => {
    const appRings = [...appCss.matchAll(/:focus-visible \{ outline: 2px solid ([^;]+);/g)].map((m) => m[1])
    expect(appRings).toEqual(['var(--focus)'])
    const libRings = [...libraryCss.matchAll(/:focus-visible \{ outline: 2px solid ([^;]+);/g)].map((m) => m[1])
    expect(libRings).toEqual(['var(--ophy-focus, #a65f20)'])
  })
})
