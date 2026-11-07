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
    columns: { ext: 64, size: 88, mtime: 132 },
    recentDirs: [],
    favorites: [],
    panes: {
      left: { path: home, sortKey: 'name', sortAsc: true },
      right: { path: downloads, sortKey: 'name', sortAsc: true }
    }
  }
}

export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file(), 'utf8')))
  } catch {
    return defaultSettings()
  }
}

/** Fills missing or invalid fields with defaults (older settings files, or settings saved by the renderer). */
export function normalizeSettings(value: unknown): Settings {
  const def = defaultSettings()
  if (!value || typeof value !== 'object') return def
  const raw = { ...(value as Partial<Settings>) }
  // Settings from 0.1.0 had a single showHidden flag that also covered dot files.
  if (raw.showDotFiles === undefined && typeof raw.showHidden === 'boolean') raw.showDotFiles = raw.showHidden
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  raw.recentDirs = strings(raw.recentDirs)
  raw.favorites = strings(raw.favorites)
  raw.windowStart = raw.windowStart === 'reset' ? 'reset' : 'restore'
  raw.showFkeys = raw.showFkeys !== false
  const width = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(600, Math.max(36, v))) : d)
  const cols = (raw.columns ?? {}) as Partial<Settings['columns']>
  raw.columns = { ext: width(cols.ext, def.columns.ext), size: width(cols.size, def.columns.size), mtime: width(cols.mtime, def.columns.mtime) }
  return {
    ...def,
    ...raw,
    panes: {
      left: { ...def.panes.left, ...raw.panes?.left },
      right: { ...def.panes.right, ...raw.panes?.right }
    }
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const tmp = file() + '.tmp'
  await fsp.mkdir(path.dirname(tmp), { recursive: true })
  await fsp.writeFile(tmp, JSON.stringify(s, null, 2), 'utf8')
  await fsp.rename(tmp, file())
}
