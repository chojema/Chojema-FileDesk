import { translate, type MsgKey } from '@shared/i18n'
import type { FileDeskApi, Lang } from '@shared/types'

declare global {
  interface Window {
    filedesk: FileDeskApi
  }
}

export const api = window.filedesk
export const isMac = api.platform === 'darwin'

let lang: Lang = 'ko'
export function setLang(l: Lang): void {
  lang = l
  document.documentElement.lang = l
}
export function getLang(): Lang {
  return lang
}
export function t(key: MsgKey, params?: Record<string, string | number>): string {
  return translate(lang, key, params)
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  let v = bytes
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${UNITS[i]}`
}

let dateFmt: Intl.DateTimeFormat | null = null
let dateFmtLang: Lang | null = null
export function formatDate(ms: number): string {
  if (!ms) return ''
  if (!dateFmt || dateFmtLang !== lang) {
    dateFmt = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    dateFmtLang = lang
  }
  return dateFmt.format(ms)
}

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  const { class: cls, ...rest } = props
  if (cls) node.className = cls
  Object.assign(node, rest)
  for (const c of children) node.append(c)
  return node
}

const ICONS = {
  folder:
    '<path fill="currentColor" d="M1.5 4.25c0-.97.78-1.75 1.75-1.75h3.1c.46 0 .9.18 1.23.51l.92.92c.14.14.33.22.53.22h3.72c.97 0 1.75.78 1.75 1.75v5.85c0 .97-.78 1.75-1.75 1.75H3.25c-.97 0-1.75-.78-1.75-1.75z"/>',
  file: '<path fill="none" stroke="currentColor" stroke-width="1.2" d="M4 1.6h5.2L12.4 4.8v9.1a.6.6 0 0 1-.6.6H4a.6.6 0 0 1-.6-.6V2.2a.6.6 0 0 1 .6-.6zM9 1.8v3.3h3.2"/>',
  up: '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M8 13V3.5M4 7.5l4-4 4 4"/>',
  link: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/>',
  back: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M10 3L5 8l5 5"/>',
  forward: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M6 3l5 5-5 5"/>',
  parent: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M3 10l5-5 5 5"/>',
  drive:
    '<rect x="1.5" y="4" width="13" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="11.5" cy="8" r=".9" fill="currentColor"/>',
  home: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2.5 7.2L8 2.5l5.5 4.7V13a.5.5 0 0 1-.5.5H9.6V10H6.4v3.5H3a.5.5 0 0 1-.5-.5z"/>',
  eye: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  eyeOff:
    '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M6.2 4c.6-.3 1.2-.5 1.8-.5 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.2M4.2 5.1C2.5 6.3 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.1 0 2.1-.3 2.9-.8M6.6 6.6a2 2 0 0 0 2.8 2.8M2 2l12 12"/>',
  tbParent: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M1.8 4.3c0-.8.6-1.4 1.4-1.4h2.9c.4 0 .7.1 1 .4l.8.8c.2.2.4.3.7.3h4.2c.8 0 1.4.6 1.4 1.4v5.9c0 .8-.6 1.4-1.4 1.4H3.2c-.8 0-1.4-.6-1.4-1.4z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M8 11V7.2M6.3 8.8L8 7.1l1.7 1.7"/>',
  tbTop: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 2.5h10M8 14V5.5M4.5 9L8 5.5 11.5 9"/>',
  tbBottom: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 13.5h10M8 2v8.5M4.5 7L8 10.5 11.5 7"/>',
  tbMkdir: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M1.8 4.3c0-.8.6-1.4 1.4-1.4h2.9c.4 0 .7.1 1 .4l.8.8c.2.2.4.3.7.3h4.2c.8 0 1.4.6 1.4 1.4v5.9c0 .8-.6 1.4-1.4 1.4H3.2c-.8 0-1.4-.6-1.4-1.4z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M8 6.8v4.4M5.8 9h4.4"/>',
  tbCopy: '<rect x="1.5" y="3" width="6.5" height="10" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M9.5 8h5M12.3 5.6L14.6 8l-2.3 2.4"/>',
  tbMove: '<rect x="1.5" y="3" width="6.5" height="10" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1.6 1.6"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M9.5 8h5M12.3 5.6L14.6 8l-2.3 2.4"/>',
  clock:
    '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M8 4.6V8l2.3 1.5"/>',
  starFill:
    '<path fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6z"/>',
  folder2:
    '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M1.8 4.3c0-.8.6-1.4 1.4-1.4h2.9c.4 0 .7.1 1 .4l.8.8c.2.2.4.3.7.3h4.2c.8 0 1.4.6 1.4 1.4v5.9c0 .8-.6 1.4-1.4 1.4H3.2c-.8 0-1.4-.6-1.4-1.4z"/>',
  plus: '<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8 3v10M3 8h10"/>',
  minus: '<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M3 8h10"/>',
  trashSmall:
    '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M2.5 4.2h11M6.3 4.2V2.8h3.4v1.4M3.8 4.2l.7 8.6c.1.7.6 1.2 1.3 1.2h4.4c.7 0 1.2-.5 1.3-1.2l.7-8.6"/>',
  tbCopyList:
    '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6 3.5h8M6 8h8M6 12.5h8"/><circle cx="2.7" cy="3.5" r="1" fill="currentColor"/><circle cx="2.7" cy="8" r="1" fill="currentColor"/><circle cx="2.7" cy="12.5" r="1" fill="currentColor"/>',
  tbCopyPath:
    '<rect x="3" y="2.8" width="10" height="11.7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path fill="currentColor" d="M5.8 1.5h4.4a.8.8 0 0 1 .8.8v1.1a.6.6 0 0 1-.6.6H5.6a.6.6 0 0 1-.6-.6V2.3a.8.8 0 0 1 .8-.8z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M5.6 7.5h4.8M5.6 10.3h3.2"/>',
  tbTerminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M4.5 6.2L6.8 8l-2.3 1.8M8.3 10.2h3.2"/>',
  tbTrash: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M2.5 4.2h11M6.3 4.2V2.8h3.4v1.4M3.8 4.2l.7 8.6c.1.7.6 1.2 1.3 1.2h4.4c.7 0 1.2-.5 1.3-1.2l.7-8.6M6.6 7v4.5M9.4 7v4.5"/>',
  star: '<path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6z"/>'
} as const

export type IconName = keyof typeof ICONS

export function icon(name: IconName, cls = 'icon'): SVGSVGElement {
  const tpl = document.createElement('template')
  tpl.innerHTML = `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`
  return tpl.content.firstElementChild as SVGSVGElement
}
