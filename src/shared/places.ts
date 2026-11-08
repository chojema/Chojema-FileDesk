import type { Place, PlaceShortcut, PlaceVisibility } from './types'

export const PLACE_SHORTCUTS: PlaceShortcut[] = ['home', 'desktop', 'documents', 'downloads']

export function normalizePlaceVisibility(value: unknown): PlaceVisibility {
  const raw = value && typeof value === 'object' ? value as Partial<PlaceVisibility> : {}
  return { home: raw.home === true, desktop: raw.desktop !== false, documents: raw.documents !== false, downloads: raw.downloads !== false }
}

export function visiblePlaces(list: Place[], visibility: PlaceVisibility): Place[] {
  return list.filter(p => !PLACE_SHORTCUTS.includes(p.id as PlaceShortcut) || visibility[p.id as PlaceShortcut])
}
