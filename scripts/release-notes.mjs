// Combines the Korean and English release notes of the current version into dist/release-body.md
// for use as the GitHub Release description.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const version = process.argv[2] || JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid version')
const read = (f) => {
  const url = new URL(`../release-notes/${f}`, import.meta.url)
  if (!existsSync(url)) {
    console.error(`Missing release-notes/${f}`)
    process.exit(1)
  }
  // Drop the cross-language link line; both languages are in one body.
  return readFileSync(url, 'utf8').replace(/^# [^\n]*\n+/, '').replace(/^\[(English|한국어)\]\(.*\)\s*$/m, '').replace(/\n{3,}/g, '\n\n').trim()
}

const body = `${read(`v${version}.md`)}\n\n---\n\n${read(`v${version}.en.md`).replace(/^# .*\n/, '')}\n`
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true })
writeFileSync(new URL('../dist/release-body.md', import.meta.url), body)
console.log(`dist/release-body.md written for v${version}`)
