#!/usr/bin/env node
// The region map's outlines (owner, 2026-11-10; ADR 0008): RESOLVE Ecoregions 2017, simplified for drawing.
//
//   node scripts/ecoregions.mjs OUT.json [--work DIR]
//
// Downloads the official release (about 150 MB), keeps ECO_ID, ECO_NAME, BIOME_NAME and REALM, simplifies to 3% of
// vertices with mapshaper 0.7.101 (MPL-2.0; not a dependency here: install it with `npm install -g mapshaper@0.7.101`,
// or point MAPSHAPER at it), and writes GeoJSON of about 8 MB. The output isn't committed; hosts
// build it once and serve it where a map shows. Same input, same output: the SHA-256 is printed to compare.
//
// Dinerstein E. et al. (2017) An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm. BioScience 67(6):
// 534-545. doi:10.1093/biosci/bix014. Data: RESOLVE Ecoregions 2017, CC BY 4.0. Credit both wherever the map shows.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SOURCE = 'https://storage.googleapis.com/teow2016/Ecoregions2017.zip'
const args = process.argv.slice(2)
const out = args[0]
if (!out) throw new Error('Usage: node scripts/ecoregions.mjs OUT.json [--work DIR]')
const wi = args.indexOf('--work')
const work = wi >= 0 ? args[wi + 1] : path.join(os.tmpdir(), 'onephylogeny-ecoregions')
mkdirSync(work, { recursive: true })
const zip = path.join(work, 'Ecoregions2017.zip')
if (!existsSync(zip)) execFileSync('curl', ['-sSfL', '-o', zip, SOURCE], { stdio: 'inherit' })
if (!existsSync(path.join(work, 'Ecoregions2017.shp'))) execFileSync('unzip', ['-q', '-o', zip, '-d', work], { stdio: 'inherit' })
execFileSync(process.env.MAPSHAPER ?? 'mapshaper', [
  path.join(work, 'Ecoregions2017.shp'), '-filter-fields', 'ECO_ID,ECO_NAME,BIOME_NAME,REALM', '-simplify', '3%', 'keep-shapes',
  '-o', 'precision=0.01', 'format=geojson', out,
], { stdio: 'inherit' })
console.log(`${out}: sha256:${createHash('sha256').update(readFileSync(out)).digest('hex')}`)
