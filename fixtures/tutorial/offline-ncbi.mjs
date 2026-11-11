// Answers the CLI's NCBI requests from fixtures/golden/records.gb, so the tutorial runs offline.
// Load it with: NODE_OPTIONS="--import ./fixtures/tutorial/offline-ncbi.mjs"
// Any other network request is refused, so nothing leaves the machine while it's loaded.
import { readFileSync } from 'node:fs'

const text = readFileSync(new URL('../golden/records.gb', import.meta.url), 'utf8')
const blocks = text.split(/^\/\/\s*$/m).filter((b) => b.includes('LOCUS')).map((b) => `${b.trimStart()}//\n`)
const byVersion = new Map(blocks.map((b) => [b.match(/^VERSION\s+(\S+)/m)[1], b]))

const answer = (body) => ({ ok: true, status: 200, text: async () => body })

globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (!u.startsWith('https://eutils.ncbi.nlm.nih.gov/')) throw new Error(`Offline tutorial: refused a request to ${u}`)
  const params = new URLSearchParams(init.body ?? '')
  if (params.get('db') !== 'nuccore') throw new Error(`Offline tutorial: no fixture answers ${params.get('db')} requests`)
  if (u.endsWith('esearch.fcgi')) {
    const ids = [...byVersion.keys()]
    return answer(JSON.stringify({ esearchresult: { count: String(ids.length), idlist: ids } }))
  }
  if (u.endsWith('efetch.fcgi')) {
    const ids = (params.get('id') ?? '').split(',')
    const missing = ids.filter((id) => !byVersion.has(id))
    if (missing.length) return { ok: false, status: 400, text: async () => `Offline tutorial: no fixture for ${missing.join(', ')}` }
    return answer(ids.map((id) => byVersion.get(id)).join(''))
  }
  throw new Error(`Offline tutorial: no fixture answers ${u}`)
}
