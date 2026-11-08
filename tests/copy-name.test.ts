import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { copyName } from '../src/shared/copy-name'

test('copy names follow Explorer and Finder', () => {
  assert.equal(copyName('Report.txt', false, 1, 'win32', 'ko'), 'Report - 복사본.txt')
  assert.equal(copyName('Report.txt', false, 2, 'win32', 'en'), 'Report - Copy (2).txt')
  assert.equal(copyName('Report.txt', false, 1, 'darwin', 'en'), 'Report copy.txt')
  assert.equal(copyName('Report.txt', false, 3, 'darwin', 'ko'), 'Report 복사본 3.txt')
  assert.equal(copyName('archive.tar.gz', false, 1, 'darwin', 'en'), 'archive.tar copy.gz')
  assert.equal(copyName('.env', false, 1, 'darwin', 'en'), '.env copy')
  assert.equal(copyName('My.Folder', true, 2, 'win32', 'en'), 'My.Folder - Copy (2)')
  assert.equal(copyName('Report copy.txt', false, 2, 'darwin', 'en'), 'Report copy 2.txt')
  assert.equal(copyName('Report 복사본 3.txt', false, 4, 'darwin', 'ko'), 'Report 복사본 4.txt')
  assert.equal(copyName('Report 복사본.txt'.normalize('NFD'), false, 2, 'darwin', 'ko'), 'Report 복사본 2.txt')
  assert.equal(copyName('Report - Copy.txt', false, 1, 'win32', 'en'), 'Report - Copy - Copy.txt')
})

test('copying into the source folder makes numbered copies', async () => {
  const { transfer } = await import('../src/main/fsops')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filedesk-dup-'))
  try {
    await fs.writeFile(path.join(dir, 'a.txt'), 'x')
    await fs.mkdir(path.join(dir, 'f'))
    await fs.writeFile(path.join(dir, 'f', 'in.txt'), 'y')
    const req = { op: 'copy' as const, sources: [path.join(dir, 'a.txt'), path.join(dir, 'f')], destDir: dir, policy: 'skip' as const, lang: 'en' as const }
    const first = await transfer(req, () => {})
    const second = await transfer(req, () => {})
    assert.equal(first.done + second.done, 4)
    const names = (await fs.readdir(dir)).sort()
    const expected = process.platform === 'win32'
      ? ['a - Copy (2).txt', 'a - Copy.txt', 'a.txt', 'f', 'f - Copy', 'f - Copy (2)']
      : ['a copy 2.txt', 'a copy.txt', 'a.txt', 'f', 'f copy', 'f copy 2']
    assert.deepEqual(names, expected.sort())
    assert.equal(await fs.readFile(path.join(second.created![1], 'in.txt'), 'utf8'), 'y')
    const moved = await transfer({ ...req, op: 'move' }, () => {})
    assert.equal(moved.skipped, 2)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
