export type FastaEntry = { id: string; description: string; sequence: string }

export function parseFasta(text: string): FastaEntry[] {
  const out: FastaEntry[] = []
  let cur: FastaEntry | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('>')) {
      const head = line.slice(1).trim()
      const cut = head.search(/\s/)
      cur = { id: cut < 0 ? head : head.slice(0, cut), description: cut < 0 ? '' : head.slice(cut + 1).trim(), sequence: '' }
      out.push(cur)
    } else {
      if (!cur) throw new Error('FASTA text has sequence before the first header')
      cur.sequence += line
    }
  }
  return out
}

export function writeFasta(entries: Pick<FastaEntry, 'id' | 'sequence'>[]): string {
  return entries.map((e) => `>${e.id}\n${e.sequence}\n`).join('')
}
