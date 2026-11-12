import type { Place, PlaceShortcut, PlaceVisibility } from './types'
import { isRemotePath } from './remote-path'

export const PLACE_SHORTCUTS: PlaceShortcut[] = ['home', 'desktop', 'documents', 'downloads']

export function normalizePlaceVisibility(value: unknown): PlaceVisibility {
  const raw = value && typeof value === 'object' ? value as Partial<PlaceVisibility> : {}
  const clouds = Object.fromEntries(Object.entries(raw).filter(([k, v]) => k.startsWith('cloud-') && typeof v === 'boolean'))
  return { ...clouds, home: raw.home === true, desktop: raw.desktop !== false, documents: raw.documents !== false, downloads: raw.downloads !== false }
}

export function visiblePlaces(list: Place[], visibility: PlaceVisibility): Place[] {
  return list.filter(p => p.kind === 'cloud' ? visibility[p.id] !== false : !PLACE_SHORTCUTS.includes(p.id as PlaceShortcut) || visibility[p.id as PlaceShortcut])
}

const CLOUD_NAMES: Record<string, string> = { GoogleDrive: 'Google Drive', OneDrive: 'OneDrive', Dropbox: 'Dropbox', SynologyDrive: 'Synology Drive', Box: 'Box', pCloudDrive: 'pCloud Drive' }

/** Readable label for a macOS ~/Library/CloudStorage folder such as "GoogleDrive-me@x.com". */
export function cloudLabel(dir: string): string {
  const i = dir.indexOf('-')
  const provider = i < 0 ? dir : dir.slice(0, i)
  const account = i < 0 ? '' : dir.slice(i + 1)
  const name = CLOUD_NAMES[provider] ?? provider
  return account ? `${name} (${account})` : name
}

export function placeTarget(place: Place, otherPath: string, list: Place[], windows: boolean): string {
  if ((place.kind !== 'drive' && place.kind !== 'volume') || isRemotePath(otherPath)) return place.path
  const key = (p: string) => (windows ? p.replace(/\\/g, '/').toLowerCase() : p).replace(/\/+$/, '')
  const other = key(otherPath)
  // The longest mount wins so an external Mac volume is not mistaken for "/".
  const drive = list.filter(p => p.kind === 'drive' || p.kind === 'volume')
    .sort((a, b) => key(b.path).length - key(a.path).length)
    .find(p => other === key(p.path) || other.startsWith(`${key(p.path)}/`))
  return drive?.id === place.id ? otherPath : place.path
}
