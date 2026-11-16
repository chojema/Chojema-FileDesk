import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listDir } from '../src/main/fsops'

test('macOS .app bundles list as openable items, plain folders stay folders', { skip: process.platform !== 'darwin' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filedesk-list-'))
  try {
    await fs.mkdir(path.join(root, 'Tool.app', 'Contents'), { recursive: true })
    await fs.mkdir(path.join(root, 'Folder'))
    const entries = (await listDir(root)).value!.entries
    const app = entries.find(e => e.name === 'Tool.app')!
    const dir = entries.find(e => e.name === 'Folder')!
    assert.deepEqual([app.isDir, app.pkg, app.ext], [false, true, 'app'])
    assert.deepEqual([dir.isDir, dir.pkg], [true, undefined])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
