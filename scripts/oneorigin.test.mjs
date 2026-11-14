// Tests for scripts/oneorigin.mjs: building CSS from the tokens, writing the lock, and the drift check.
// Run with `node --test scripts/oneorigin.test.mjs`. Everything runs on throwaway copies in the system's temp folder,
// with no network: the check's download path is only reached with a URL, and these tests never give it one.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { build, buildCss, check, COPY_PATH, LOCK_PATH, lock, SOURCE_PATH, validateTokens } from './oneorigin.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(repo, 'scripts/oneorigin.mjs')
const tokens = JSON.parse(readFileSync(join(repo, SOURCE_PATH, 'tokens.json'), 'utf8'))
const temps = []
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** A throwaway source checkout (a git repo holding docs/oneorigin) and a tool repo with a locked copy and one built CSS file. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'oneorigin-'))
  temps.push(base)
  const source = join(base, 'source')
  const tool = join(base, 'tool')
  cpSync(join(repo, SOURCE_PATH), join(source, SOURCE_PATH), { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'Source')
  mkdirSync(tool, { recursive: true })
  const value = lock(tool, { source, copy: true })
  build(tool, { prefix: 'op', out: 'app/oneorigin.css' })
  return { source, tool, git, commit: value.source.commit }
}

const varsIn = (css, start) => {
  const at = css.indexOf(start)
  assert.ok(at >= 0, start)
  return Object.fromEntries([...css.slice(at, css.indexOf('}', at)).matchAll(/(--[a-z0-9-]+): ([^;]+);/g)].map((m) => [m[1], m[2]]))
}

const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe('tokens.json', () => {
  it('passes its JSON Schema and the script\'s own checks', async () => {
    const require = createRequire(join(repo, 'package.json'))
    const Ajv2020 = require('ajv/dist/2020.js')
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    const validate = ajv.compile(JSON.parse(readFileSync(join(repo, SOURCE_PATH, 'tokens.schema.json'), 'utf8')))
    assert.ok(validate(tokens), JSON.stringify(validate.errors, null, 2))
    assert.deepEqual(validateTokens(tokens), [])
  })

  it('holds the owner\'s focus rule and the three tools\' tiles, and leaves OneLineage out', () => {
    assert.deepEqual([tokens.color.focus.light, tokens.color.focus.dark, tokens.color.accent.light], ['#a65f20', '#e7a066', '#cf8137'])
    assert.deepEqual(Object.keys(tokens.tools).sort(), ['onepedigree', 'onephylogeny', 'onetaxonomy'])
    assert.deepEqual(Object.values(tokens.tools).map((t) => t.prefix).sort(), ['op', 'ophy', 'ot'])
  })

  it('keeps focus rings 3:1 or better, and text 4.5:1, on every background each tool uses', () => {
    for (const [id, tool] of Object.entries(tokens.tools)) {
      for (const mode of ['light', 'dark']) {
        const c = (name) => (tool.color[name] ?? tokens.color[name])[mode]
        for (const bg of [c('background'), c('panel')]) {
          assert.ok(contrast(c('focus'), bg) >= 3, `${id} ${mode} focus on ${bg}: ${contrast(c('focus'), bg).toFixed(2)}`)
          for (const fg of ['text', 'muted']) assert.ok(contrast(c(fg), bg) >= 4.5, `${id} ${mode} ${fg} on ${bg}`)
        }
      }
    }
  })

  it('refuses a tool color that would replace a shared one, a bad color and a repeated prefix', () => {
    const bad = structuredClone(tokens)
    bad.tools.onepedigree.color.accent = { light: '#00ff00', dark: '#00ff00' }
    bad.tools.onetaxonomy.color.panel.light = 'pink'
    bad.tools.onephylogeny.prefix = 'op'
    const problems = validateTokens(bad)
    assert.ok(problems.some((p) => p.includes('tools.onepedigree.color.accent would replace a shared color')), problems.join('\n'))
    assert.ok(problems.some((p) => p.includes('tools.onetaxonomy.color.panel.light')))
    assert.ok(problems.some((p) => p.includes('prefix op is used twice')))
    assert.throws(() => buildCss(bad, 'ot'), /tokens.json has problems/)
  })
})

// The palette's checks, as the owner approved them on 2026-11-12: any two of the four tool colors and the one stay
// apart by a CIELAB difference of 15 or more with normal vision and under protanopia, deuteranopia and tritanopia;
// every text color is 4.5:1 or better on white; the one is 4.5:1 or better on white, and its dark version on the
// dark backgrounds. Colorblind views use the Machado, Oliveira and Fernandes (2009) matrices at full severity, applied
// in linear RGB, the same way the approved numbers were worked out.
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toLinear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (c) => ((c = Math.min(1, Math.max(0, c))), 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
const hexOf = (channels) => '#' + channels.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const seenAs = (hex, kind) => {
  if (kind === 'normal') return hex
  const lin = rgb(hex).map(toLinear)
  return hexOf(CVD[kind].map((row) => fromLinear(row.reduce((sum, m, j) => sum + m * lin[j], 0))))
}
const lab = (hex) => {
  const [r, g, b] = rgb(hex).map(toLinear)
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883]
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]))
/** The closest two colors in a set, as seen with one kind of vision. */
const closest = (colors, kind) => {
  let best = { d: Infinity }
  colors.forEach((a, i) => colors.slice(i + 1).forEach((b) => {
    const d = deltaE(seenAs(a, kind), seenAs(b, kind))
    if (d < best.d) best = { d, pair: `${a} and ${b}` }
  }))
  return best
}
/** Moves a color part of the way toward white (or another color), as the level shades are made. */
const mix = (hex, t, to = [255, 255, 255]) => hexOf(rgb(hex).map((c, i) => c + (to[i] - c) * t))

describe('the palette', () => {
  const palette = tokens.palette
  const bases = Object.values(palette.tools).map((t) => t.base)
  const darkBackgrounds = [palette['dark-background'], tokens.color.background.dark]

  it('has the four tools, OneLineage included, in the approved colors', () => {
    assert.deepEqual(Object.keys(palette.tools), ['onetaxonomy', 'onephylogeny', 'onelineage', 'onepedigree'])
    assert.deepEqual(bases, ['#fc9583', '#44a446', '#3fb1e4', '#907be8'])
    assert.deepEqual([palette['the-one'].light, palette['the-one'].dark, palette.center], ['#1f6f6b', '#3fb3a8', '#fbf8f2'])
    assert.deepEqual([palette.lines.light, palette.lines.dark], ['#363051', '#ece6f2'])
  })

  const vision = { normal: 'with normal vision', protan: 'under protanopia', deutan: 'under deuteranopia', tritan: 'under tritanopia' }
  for (const [kind, words] of Object.entries(vision)) {
    it(`keeps the four tool colors and the one 15 or more apart, ${words}`, () => {
      const { d, pair } = closest([...bases, palette['the-one'].light], kind)
      assert.ok(d >= 15, `${pair} are only ${d.toFixed(1)} apart`)
    })
  }

  it('gives every tool a text color of 4.5:1 or better on white, and the one 4.5:1 on white and on the dark backgrounds', () => {
    for (const [id, tool] of Object.entries(palette.tools)) assert.ok(contrast(tool.text, '#ffffff') >= 4.5, `${id} text ${tool.text}: ${contrast(tool.text, '#ffffff').toFixed(2)}`)
    assert.ok(contrast(palette['the-one'].light, '#ffffff') >= 4.5, 'the one on white')
    assert.ok(contrast(palette['the-one'].light, palette.center) >= 4.5, 'the one on the cream center')
    for (const bg of darkBackgrounds) assert.ok(contrast(palette['the-one'].dark, bg) >= 4.5, `the one, dark, on ${bg}: ${contrast(palette['the-one'].dark, bg).toFixed(2)}`)
  })

  it('draws lines at 3:1 or better, aubergine on white and pale on the dark backgrounds', () => {
    assert.ok(contrast(palette.lines.light, '#ffffff') >= 3)
    for (const bg of darkBackgrounds) assert.ok(contrast(palette.lines.dark, bg) >= 3, bg)
  })

  it('makes the level shades and text colors from each tool color by the stated rule', () => {
    for (const [id, tool] of Object.entries(palette.tools)) {
      assert.equal(tool.level1, mix(tool.base, 0.3), `${id} level 1 is 30% toward white`)
      assert.equal(tool.level2, mix(tool.base, 0.52), `${id} level 2 is 52% toward white`)
      // The text color is the base darkened toward black in steps of 2%, stopping at the first that reaches 4.5:1.
      let t = 0
      while (contrast(mix(tool.base, t, [0, 0, 0]), '#ffffff') < 4.5 && t < 0.9) t += 0.02
      assert.equal(tool.text, mix(tool.base, t, [0, 0, 0]), `${id} text`)
    }
  })
})

describe('the marks', () => {
  const palette = tokens.palette
  const marks = { oneorigin: 'OneOrigin', onetaxonomy: 'OneTaxonomy', onephylogeny: 'OnePhylogeny', onelineage: 'OneLineage', onepedigree: 'OnePedigree' }
  const files = readdirSync(join(repo, SOURCE_PATH, 'marks')).sort()
  const shades = Object.values(palette.tools).flatMap((t) => [t.base, t.level1, t.level2])

  it('are the five marks, each light, dark and small', () => {
    assert.deepEqual(files, Object.keys(marks).flatMap((m) => ['dark', 'light', 'small'].map((v) => `${m}-${v}.svg`)).sort())
  })

  for (const [slug, name] of Object.entries(marks)) {
    it(`${name}: labelled, plain SVG, only palette colors, and the one in teal with a cream center`, () => {
      for (const variant of ['light', 'dark', 'small']) {
        const svg = readFileSync(join(repo, SOURCE_PATH, 'marks', `${slug}-${variant}.svg`), 'utf8')
        const where = `${slug}-${variant}.svg`
        assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img"'), where)
        assert.ok(svg.includes(`aria-label="${name} mark"><title>${name} mark</title>`), `${where}: labelled`)
        assert.doesNotMatch(svg, /<script|<image|<style|<foreignObject|href=|\son[a-z]+=|opacity/i, `${where}: plain shapes only, always solid`)
        const mode = variant === 'dark' ? 'dark' : 'light'
        const allowed = new Set([palette.lines[mode], palette['the-one'][mode], palette.center, ...shades, 'none'])
        const used = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1])
        for (const c of used) assert.ok(allowed.has(c), `${where}: ${c} isn't in the palette for ${mode} backgrounds`)
        const one = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="[\\d.]+" fill="${palette['the-one'][mode]}"/><circle cx="\\1" cy="\\2" r="[\\d.]+" fill="${palette.center}"/>`)
        assert.match(svg, one, `${where}: the one, with its cream center`)
        assert.ok(svg.includes(`stroke="${palette.lines[mode]}"`), `${where}: lines in ${mode === 'dark' ? 'the pale' : 'aubergine'}`)
      }
    })
  }

  it('give each tool mark its own color, and the suite mark all four', () => {
    for (const [id, tool] of Object.entries(palette.tools)) {
      const svg = readFileSync(join(repo, SOURCE_PATH, 'marks', `${id}-light.svg`), 'utf8')
      assert.ok([tool.base, tool.level1, tool.level2].some((c) => svg.includes(`fill="${c}"`)), id)
      for (const [other, o] of Object.entries(palette.tools)) if (other !== id) for (const c of [o.base, o.level1, o.level2]) assert.ok(!svg.includes(`fill="${c}"`), `${id} uses ${other}'s ${c}`)
    }
    const suite = readFileSync(join(repo, SOURCE_PATH, 'marks/oneorigin-light.svg'), 'utf8')
    for (const tool of Object.values(palette.tools)) assert.ok(suite.includes(`fill="${tool.base}"`), tool.base)
  })
})

describe('build', () => {
  it('writes each tool\'s variables under its prefix, light at :root and dark for both the system and a chosen Dark', () => {
    const css = buildCss(tokens, 'ophy')
    const light = varsIn(css, ':root {')
    assert.equal(light['--ophy-focus'], '#a65f20')
    assert.equal(light['--ophy-accent'], '#cf8137')
    assert.equal(light['--ophy-panel'], '#fbf7f4')
    assert.equal(light['--ophy-radius-button'], '8px')
    assert.equal(light['--ophy-button-height'], '32px')
    assert.equal(light['--ophy-tile-top'], '#e6d6d2')
    for (const start of [":root:not([data-appearance='light'])", ":root[data-appearance='dark'] {"]) {
      const dark = varsIn(css, start)
      assert.equal(dark['--ophy-focus'], '#e7a066')
      assert.equal(dark['--ophy-background'], '#12151b')
      assert.equal(dark['--ophy-radius-button'], undefined, 'lengths are only written once')
    }
    assert.ok(!/--o(p|t)-/.test(css), 'no other tool\'s prefix')
    assert.equal(buildCss(tokens, 'ophy'), css, 'the same tokens give the same bytes')
  })

  it('gives each tool its own panel and status colors, and only the ones it has', () => {
    assert.equal(varsIn(buildCss(tokens, 'op'), ':root {')['--op-panel'], '#f7f8fa')
    assert.equal(varsIn(buildCss(tokens, 'op'), ':root {')['--op-error'], undefined)
    assert.equal(varsIn(buildCss(tokens, 'ot'), ':root {')['--ot-error'], '#b91c1c')
    assert.equal(varsIn(buildCss(tokens, 'ot'), ':root {')['--ot-tile-bottom'], '#eda9ac')
  })

  it('refuses an unknown prefix, and --prefix without --out', () => {
    assert.throws(() => buildCss(tokens, 'ol'), /No tool in tokens.json has the prefix "ol"/)
    assert.throws(() => build(repo, { prefix: 'ophy' }), /both --prefix and --out/)
  })
})

describe('lock and check', () => {
  it('a fresh copy passes, with the source commit, a checksum per file and the built CSS recorded', async () => {
    const { tool, commit, git } = fixture()
    const value = JSON.parse(readFileSync(join(tool, LOCK_PATH), 'utf8'))
    assert.equal(value.source.commit, commit)
    assert.equal(commit, git('rev-parse', 'HEAD'))
    assert.equal(value.source.repo, 'https://github.com/ExtantApe/OnePhylogeny')
    assert.ok(value.files['tokens.json'].startsWith('sha256:'))
    assert.ok(Object.keys(value.files).includes('icons/heart-badge.svg'))
    assert.deepEqual(value.outputs, { 'app/oneorigin.css': 'op' })
    const result = await check(tool, { offline: true })
    assert.deepEqual(result.errors, [])
  })

  it('fails on a hand edit, a missing file and an added file in the copy', async () => {
    const { tool } = fixture()
    writeFileSync(join(tool, COPY_PATH, 'brand.md'), readFileSync(join(tool, COPY_PATH, 'brand.md'), 'utf8') + '\nEdited here.\n')
    rmSync(join(tool, COPY_PATH, 'icons/block.svg'))
    writeFileSync(join(tool, COPY_PATH, 'notes.md'), 'mine\n')
    const { errors } = await check(tool, { offline: true })
    assert.equal(errors.length, 3, errors.join('\n'))
    assert.ok(errors.some((e) => e.startsWith('brand/oneorigin/brand.md: changed')))
    assert.ok(errors.some((e) => e.startsWith('brand/oneorigin/icons/block.svg: missing')))
    assert.ok(errors.some((e) => e.startsWith('brand/oneorigin/notes.md: not in the lock')))
  })

  it('fails when the built CSS is edited by hand or missing, and build puts it right', async () => {
    const { tool } = fixture()
    const css = join(tool, 'app/oneorigin.css')
    writeFileSync(css, readFileSync(css, 'utf8').replace('--op-focus: #a65f20', '--op-focus: #cf8137'))
    assert.match((await check(tool, { offline: true })).errors.join('\n'), /app\/oneorigin.css differs from what build writes/)
    rmSync(css)
    assert.match((await check(tool, { offline: true })).errors.join('\n'), /app\/oneorigin.css is missing/)
    build(tool)
    assert.deepEqual((await check(tool, { offline: true })).errors, [])
  })

  it('fails with no lock', async () => {
    const { tool } = fixture()
    rmSync(join(tool, LOCK_PATH))
    assert.match((await check(tool, { offline: true })).errors[0], /brand\/oneorigin.lock is missing/)
  })

  it('only warns when the source has moved ahead, naming the files', async () => {
    const { tool, source } = fixture()
    writeFileSync(join(source, SOURCE_PATH, 'guidelines.md'), 'A newer rule.\n')
    writeFileSync(join(source, SOURCE_PATH, 'new.md'), 'New.\n')
    const { errors, warnings } = await check(tool, { source })
    assert.deepEqual(errors, [])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /The source differs from the lock .*guidelines.md: changed, new.md: added at the source/)
  })

  it('only warns when the source can\'t be reached, and still checks the copy', async () => {
    const { tool, base = dirname(tool) } = fixture()
    for (const opts of [{ offline: true }, { source: join(base, 'nowhere') }]) {
      const { errors, warnings } = await check(tool, opts)
      assert.deepEqual(errors, [])
      assert.equal(warnings.length, 1)
      assert.match(warnings[0], /Couldn't check whether the source has moved ahead/)
    }
  })

  it('lock refuses a copy that differs from the source, and a source with uncommitted changes', () => {
    const { tool, source } = fixture()
    writeFileSync(join(tool, COPY_PATH, 'brand.md'), 'Edited.\n')
    assert.throws(() => lock(tool, { source }), /brand\/oneorigin doesn't match the source[\s\S]*brand.md: changed/)
    writeFileSync(join(source, SOURCE_PATH, 'brand.md'), 'Uncommitted.\n')
    assert.throws(() => lock(tool, { source, copy: true }), /uncommitted changes/)
  })

  it('a later lock keeps the recorded CSS outputs', () => {
    const { tool, source } = fixture()
    assert.deepEqual(lock(tool, { source }).outputs, { 'app/oneorigin.css': 'op' })
  })
})

describe('command line', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', ...env } })

  it('check exits 0 on a good copy and 1 on a hand edit, with GitHub annotations in Actions', () => {
    const { tool } = fixture()
    const ok = run(['check', '--root', tool, '--offline'])
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /Warning: Couldn't check[\s\S]*OneOrigin check passed: 26 files match/)
    writeFileSync(join(tool, COPY_PATH, 'tokens.json'), '{}\n')
    const bad = run(['check', '--root', tool, '--offline'], { GITHUB_ACTIONS: 'true' })
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /::error::brand\/oneorigin\/tokens.json: changed/)
    assert.match(bad.stdout, /::warning::Couldn't check/)
  })

  it('refuses unknown options and commands', () => {
    assert.equal(run(['check', '--fast']).status, 1)
    assert.equal(run(['publish']).status, 1)
  })
})

describe('this repo', () => {
  it('its own copy passes against its own source, with no warning', async () => {
    assert.deepEqual(await check(repo), { errors: [], warnings: [] })
  })

  it('the icon parts are cut from the tools\' icons without changing a value', () => {
    const icon = readFileSync(join(repo, 'brand/icon.svg'), 'utf8')
    const badge = readFileSync(join(repo, SOURCE_PATH, 'icons/heart-badge.svg'), 'utf8')
    const paths = [...badge.matchAll(/<(?:ellipse|path) [^>]+\/>/g)].map((m) => m[0])
    assert.equal(paths.length, 4)
    for (const p of paths) assert.ok(icon.includes(p), p.slice(0, 60))
    for (const [id, tool] of Object.entries(tokens.tools)) {
      const tile = readFileSync(join(repo, SOURCE_PATH, `icons/tile-${id}.svg`), 'utf8')
      assert.ok(tile.includes(`stop-color="${tool.tile.top}"`) && tile.includes(`stop-color="${tool.tile.bottom}"`), id)
      assert.ok(tile.includes('<rect x="64" y="64" width="896" height="896" rx="200"'), id)
    }
    assert.ok(icon.includes('stop-color="#e6d6d2"') && icon.includes('stop-color="#c9aca5"'))
  })

  // Owner decision: connectors have round joins. A join only applies inside one path, so two strokes that end
  // on the same point make a corner with a notch in it, whatever stroke-linejoin says.
  it('its icons draw connectors with round joins and no corner made of two separate strokes, and are labelled', () => {
    for (const file of ['brand/icon.svg', 'brand/icon-small.svg']) {
      const icon = readFileSync(join(repo, file), 'utf8')
      const label = /aria-labelledby="([^"]+)"/.exec(icon)?.[1]
      assert.ok(label && icon.includes(`<title id="${label}">`), `${file}: aria-labelledby must name its title`)
      const connector = /<path d="([^"]+)" fill="none" stroke="#4c312c" stroke-width="(\d+)" stroke-linejoin="round" \/>/.exec(icon)
      assert.ok(connector, `${file}: one brown connector path with round joins`)
      assert.match(connector[1], /^(?:[MHV][\d. ]+)+$/, `${file}: the connector uses only M, H and V`)
      const ends = []
      for (const sub of connector[1].split('M').filter(Boolean)) {
        const [x0, y0] = sub.match(/^[\d.]+ [\d.]+/)[0].split(' ').map(Number)
        let [x, y] = [x0, y0]
        for (const [, cmd, n] of sub.matchAll(/([HV])([\d.]+)/g)) cmd === 'H' ? (x = Number(n)) : (y = Number(n))
        ends.push(`${x0},${y0}`, `${x},${y}`)
      }
      assert.equal(new Set(ends).size, ends.length, `${file}: two strokes end on the same point: ${ends.join(' ')}`)
    }
    const widths = { 'brand/icon.svg': tokens.icon.connector.width, 'brand/icon-small.svg': tokens.icon['connector-small'].width }
    for (const [file, width] of Object.entries(widths)) assert.ok(readFileSync(join(repo, file), 'utf8').includes(`stroke-width="${width}" stroke-linejoin="round"`), file)
    for (const text of ['guidelines.md', 'brand.md']) {
      const words = readFileSync(join(repo, SOURCE_PATH, text), 'utf8')
      assert.ok(words.includes('round joins') && !words.includes('square joins'), text)
    }
  })
})
