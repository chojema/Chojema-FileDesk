import type { Place, PlaceShortcut, PlaceVisibility } from './types'
import { isRemotePath } from './remote-path'

export const PLACE_SHORTCUTS: PlaceShortcut[] = ['home', 'desktop', 'documents', 'downloads']

export function normalizePlaceVisibility(value: unknown): PlaceVisibility {
  const raw = value && typeof value === 'object' ? value as Partial<PlaceVisibility> : {}
  return { home: raw.home === true, desktop: raw.desktop !== false, documents: raw.documents !== false, downloads: raw.downloads !== false }
}

export function visiblePlaces(list: Place[], visibility: PlaceVisibility): Place[] {
  return list.filter(p => !PLACE_SHORTCUTS.includes(p.id as PlaceShortcut) || visibility[p.id as PlaceShortcut])
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
