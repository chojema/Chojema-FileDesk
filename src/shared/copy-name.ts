import type { Lang } from './types'

/**
 * Name of the n-th copy (n >= 1) made in the same folder, following the OS file manager:
 * Windows "Report - Copy.txt", "Report - Copy (2).txt"; macOS "Report copy.txt", "Report copy 2.txt".
 * Like Finder, copying "Report copy.txt" on macOS numbers it instead of adding another "copy".
 */
export function copyName(name: string, isDir: boolean, n: number, platform: string, lang: Lang): string {
  name = name.normalize('NFC') // macOS pasteboard paths arrive decomposed
  const dot = isDir ? -1 : name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  if (platform === 'win32') {
    const word = lang === 'ko' ? '복사본' : 'Copy'
    return `${stem} - ${word}${n > 1 ? ` (${n})` : ''}${ext}`
  }
  const word = lang === 'ko' ? '복사본' : 'copy'
  const base = stem.match(new RegExp(`^(.+) ${word}(?: \\d+)?$`))?.[1] ?? stem
  return `${base} ${word}${n > 1 ? ` ${n}` : ''}${ext}`
}
