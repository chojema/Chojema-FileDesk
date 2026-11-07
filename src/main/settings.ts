import { app } from 'electron'
import { promises as fsp, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Settings } from '@shared/types'

// Settings live only on the local machine (the OS per-user app data folder). Nothing is sent anywhere.
const file = () => path.join(app.getPath('userData'), 'settings.json')

export function defaultSettings(): Settings {
  const home = os.homedir()
  let downloads = home
  try {
    downloads = app.getPath('downloads')
  } catch {
    /* fall back to home */
  }
  const lang = app.getLocale().toLowerCase().startsWith('ko') ? 'ko' : 'en'
  return {
    lang,
    theme: 'system',
    showHidden: false,
    showDotFiles: false,
    confirmDelete: true,
    checkUpdatesOnStart: false,
    windowStart: 'restore',
    showFkeys: true,
    recentDirs: [],
    favorites: [],
    panes: {
      left: { path: home, sortKey: 'name', sortAsc: true },
      right: { path: downloads, sortKey: 'name', sortAsc: true }
    }
  }
}

export function loadSettings(): Settings {
  const def = defaultSettings()
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
    // Settings from 0.1.0 had a single showHidden flag that also covered dot files.
    if (raw.showDotFiles === undefined && typeof raw.showHidden === 'boolean') raw.showDotFiles = raw.showHidden
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    raw.recentDirs = strings(raw.recentDirs)
    raw.favorites = strings(raw.favorites)
    raw.windowStart = raw.windowStart === 'reset' ? 'reset' : 'restore'
    raw.showFkeys = raw.showFkeys !== false
    return {
      ...def,
      ...raw,
      panes: {
        left: { ...def.panes.left, ...raw.panes?.left },
        right: { ...def.panes.right, ...raw.panes?.right }
      }
    }
  } catch {
    return def
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const tmp = file() + '.tmp'
  await fsp.mkdir(path.dirname(tmp), { recursive: true })
  await fsp.writeFile(tmp, JSON.stringify(s, null, 2), 'utf8')
  await fsp.rename(tmp, file())
}
