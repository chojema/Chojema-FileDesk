import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePlaceVisibility, placeTarget, visiblePlaces } from '../src/shared/places'
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

test('drive clicks use the other pane folder only on the same Windows drive', () => {
  const c: Place = { id: 'drive-C', label: 'C:', path: 'C:\\', kind: 'drive' }
  const d: Place = { id: 'drive-D', label: 'D:', path: 'D:\\', kind: 'drive' }
  const list = [c, d]
  assert.equal(placeTarget(d, 'D:\\work\\docs', list, true), 'D:\\work\\docs')
  assert.equal(placeTarget(d, 'd:/work/docs', list, true), 'd:/work/docs')
  assert.equal(placeTarget(d, 'D:\\', list, true), 'D:\\')
  assert.equal(placeTarget(d, 'C:\\work', list, true), d.path)
  assert.equal(placeTarget(d, 'D:relative', list, true), d.path)
  assert.equal(placeTarget(d, 'sftp://host/D:/work', list, true), d.path)
  const desktop: Place = { id: 'desktop', label: 'Desktop', path: 'D:\\Desktop', kind: 'folder' }
  assert.equal(placeTarget(desktop, 'D:\\Desktop\\work', list, true), desktop.path)
  const server: Place = { id: 'server', label: 'Server', path: 'sftp://host/', kind: 'server' }
  assert.equal(placeTarget(server, 'sftp://host/work', [server], true), server.path)
})

test('volume clicks distinguish nested mounts and full path boundaries on Mac', () => {
  const root: Place = { id: 'root', label: '/', path: '/', kind: 'volume' }
  const usb: Place = { id: 'vol-USB', label: 'USB', path: '/Volumes/USB', kind: 'volume' }
  const list = [root, usb]
  assert.equal(placeTarget(root, '/Users/test/work', list, false), '/Users/test/work')
  assert.equal(placeTarget(usb, '/Volumes/USB/work', list, false), '/Volumes/USB/work')
  assert.equal(placeTarget(usb, '/Volumes/USB', list, false), usb.path)
  assert.equal(placeTarget(root, '/Volumes/USB/work', list, false), root.path)
  assert.equal(placeTarget(usb, '/Volumes/USB2/work', list, false), usb.path)
  assert.equal(placeTarget(usb, '/Volumes/usb/work', list, false), usb.path)
  assert.equal(placeTarget(usb, '/Volumes/USB\\work', list, false), usb.path)
  assert.equal(placeTarget(root, 'ftp://host/work', list, false), root.path)
})
