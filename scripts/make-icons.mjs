// Renders the app icon SVG into the PNG sources used by electron-builder.
//   build/icon.png      1024x1024, macOS grid (824px body + shadow)
//   build/icon-win.png  1024x1024, full-bleed body for Windows
//   resources/icon-256.png  preview for README
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const art = readFileSync(new URL('../build/icon-art.svg', import.meta.url), 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')

function frame({ inset, radius, shadow }) {
  const size = 1024 - inset * 2
  const scale = size / 1024
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${shadow ? 14 : 0}" stdDeviation="${shadow ? 18 : 0}" flood-color="#0b0d2a" flood-opacity="${shadow ? 0.35 : 0}"/>
    </filter>
    <clipPath id="body"><rect x="0" y="0" width="1024" height="1024" rx="${radius}"/></clipPath>
  </defs>
  <g transform="translate(${inset} ${inset}) scale(${scale})" filter="url(#sh)">
    <g clip-path="url(#body)">${art}</g>
  </g>
</svg>`
}

function render(svg, width, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()
  writeFileSync(new URL(out, import.meta.url), png)
  console.log('wrote', out)
}

mkdirSync(new URL('../resources/', import.meta.url), { recursive: true })
const mac = frame({ inset: 100, radius: 230, shadow: true })
const win = frame({ inset: 24, radius: 200, shadow: false })
writeFileSync(new URL('../build/icon.svg', import.meta.url), mac)
render(mac, 1024, '../build/icon.png')
render(win, 1024, '../build/icon-win.png')
render(mac, 256, '../resources/icon-256.png')
