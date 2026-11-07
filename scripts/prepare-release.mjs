// Usage: npm run release:prepare -- <patch|minor|major|x.y.z>
// Bumps package.json version and creates Korean/English release-note stubs + CHANGELOG headings.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: npm run release:prepare -- <patch|minor|major|x.y.z>')
  process.exit(1)
}

const pkgUrl = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'))
const [maj, min, pat] = pkg.version.split('-')[0].split('.').map(Number)
const next =
  arg === 'major' ? `${maj + 1}.0.0` : arg === 'minor' ? `${maj}.${min + 1}.0` : arg === 'patch' ? `${maj}.${min}.${pat + 1}` : arg
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(next)) {
  console.error(`Invalid version: ${next}`)
  process.exit(1)
}

const lockUrl = new URL('../package-lock.json', import.meta.url)
pkg.version = next
writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n')
if (existsSync(lockUrl)) {
  const lock = JSON.parse(readFileSync(lockUrl, 'utf8'))
  lock.version = next
  if (lock.packages?.['']) lock.packages[''].version = next
  writeFileSync(lockUrl, JSON.stringify(lock, null, 2) + '\n')
}

const date = new Date().toISOString().slice(0, 10)
const stubs = {
  [`release-notes/v${next}.md`]: `# Chojema FileDesk v${next}\n\n출시일: ${date}\n\n[English](v${next}.en.md)\n\n## 새 기능\n\n- \n\n## 개선\n\n- \n\n## 버그 수정\n\n- \n`,
  [`release-notes/v${next}.en.md`]: `# Chojema FileDesk v${next}\n\nRelease date: ${date}\n\n[한국어](v${next}.md)\n\n## New\n\n- \n\n## Improved\n\n- \n\n## Fixed\n\n- \n`
}
for (const [file, body] of Object.entries(stubs)) {
  const url = new URL(`../${file}`, import.meta.url)
  if (!existsSync(url)) writeFileSync(url, body)
}

for (const [file, heading] of [
  ['CHANGELOG.md', `## [${next}] - ${date}\n\n- 자세한 내용: [release-notes/v${next}.md](release-notes/v${next}.md)\n`],
  ['CHANGELOG.en.md', `## [${next}] - ${date}\n\n- Details: [release-notes/v${next}.en.md](release-notes/v${next}.en.md)\n`]
]) {
  const url = new URL(`../${file}`, import.meta.url)
  const text = readFileSync(url, 'utf8')
  if (text.includes(`## [${next}]`)) continue
  const idx = text.indexOf('\n## ')
  writeFileSync(url, idx < 0 ? `${text.trimEnd()}\n\n${heading}` : `${text.slice(0, idx + 1)}${heading}\n${text.slice(idx + 1)}`)
}

console.log(`Version set to ${next}. Edit release-notes/v${next}.md and v${next}.en.md, then build.`)
