import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePlaceVisibility, visiblePlaces } from '../src/shared/places'
import type { Place } from '../src/shared/types'

test('old settings hide Home by default and keep the other shortcuts', () => {
  assert.deepEqual(normalizePlaceVisibility(undefined), { home: false, desktop: true, documents: true, downloads: true })
  assert.deepEqual(normalizePlaceVisibility(null), normalizePlaceVisibility(undefined))
  assert.deepEqual(normalizePlaceVisibility({ home: true, desktop: false, documents: false, downloads: false }), { home: true, desktop: false, documents: false, downloads: false })
  assert.deepEqual(normalizePlaceVisibility({ home: 'true', desktop: null }), normalizePlaceVisibility(undefined))
})

test('hiding all shortcuts preserves drives and servers, without changing the discovery list', () => {
  const ids = ['home', 'desktop', 'documents', 'downloads', 'drive-C', 'vol-USB', 'server-test']
  const list = ids.map(id => ({ id, label: id, path: id, kind: 'folder' })) as Place[]
  const hidden = normalizePlaceVisibility({ desktop: false, documents: false, downloads: false })
  assert.deepEqual(visiblePlaces(list, hidden).map(p => p.id), ids.slice(4))
  assert.deepEqual(list.map(p => p.id), ids)
  assert.deepEqual(visiblePlaces(list, { home: true, desktop: true, documents: true, downloads: true }), list)
})
