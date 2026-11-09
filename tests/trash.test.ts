import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileService } from '../src/main/file-service'
import { RemoteManager } from '../src/main/remote'
import type * as Local from '../src/main/fsops'
import type { Progress } from '../src/shared/types'

const failedTrash = async (paths: string[]) => ({ done: 0, skipped: 0, errors: paths.map(path => ({ path, message: 'Cannot recycle' })) })
const service = (trash = failedTrash) => new FileService({ trash } as typeof Local, new RemoteManager(async () => false))

test('failed Trash preserves files without confirmation and when cancelled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filedesk-trash-'))
  const file = path.join(root, 'original.txt')
  await fs.writeFile(file, 'original')
  try {
    const files = service()
    for (const confirm of [undefined, async (paths: string[]) => {
      assert.deepEqual(paths, [file])
      assert.equal(await fs.readFile(file, 'utf8'), 'original')
      return false
    }]) {
      const result = await files.trash([file], () => {}, confirm)
      assert.equal(result.done, 0)
      assert.deepEqual(result.errors, [{ path: file, message: 'Cannot recycle' }])
      assert.equal(await fs.readFile(file, 'utf8'), 'original')
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('confirmed fallback deletes only failed local items and does not follow symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filedesk-trash-'))
  const recycled = path.join(root, 'recycled.txt'), file = path.join(root, 'USB file.txt')
  const folder = path.join(root, 'USB folder'), outside = path.join(root, 'keep.txt')
  await fs.mkdir(folder)
  await Promise.all([fs.writeFile(file, 'file'), fs.writeFile(recycled, 'recycled'), fs.writeFile(outside, 'keep'), fs.writeFile(path.join(folder, 'child.txt'), 'child')])
  // A directory junction on Windows needs no developer-mode symlink permission.
  await fs.symlink(root, path.join(folder, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  try {
    const files = service(async paths => paths[0] === recycled
      ? { done: 1, skipped: 0, errors: [] } : failedTrash(paths))
    const progress: Progress[] = []
    let prompts = 0
    const remoteRoot = 'sftp://example.test/'
    const result = await files.trash([recycled, file, folder, remoteRoot], p => progress.push(p), async paths => {
      prompts++
      assert.deepEqual(paths, [file, folder])
      assert.equal(await fs.readFile(file, 'utf8'), 'file')
      return true
    })
    assert.equal(prompts, 1)
    assert.equal(result.done, 3)
    assert.deepEqual(result.errors, [{ path: remoteRoot, message: 'Cannot delete a server root' }])
    await assert.rejects(fs.lstat(file), { code: 'ENOENT' })
    await assert.rejects(fs.lstat(folder), { code: 'ENOENT' })
    assert.equal(await fs.readFile(outside, 'utf8'), 'keep')
    assert.equal(await fs.readFile(recycled, 'utf8'), 'recycled', 'successful Trash items are never retried')
    assert.deepEqual(progress.at(-1), { current: '', index: 4, total: 4 })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('successful Trash never asks to delete permanently', async () => {
  const files = service(async () => ({ done: 1, skipped: 0, errors: [] }))
  const result = await files.trash([path.join(os.tmpdir(), 'successful.txt')], () => {}, async () => {
    assert.fail('No confirmation for successful Trash')
  })
  assert.deepEqual(result, { done: 1, skipped: 0, errors: [] })
})

test('drive roots, relative paths and remote roots are never permanent-delete candidates', async () => {
  const files = service()
  const root = path.parse(process.cwd()).root
  const paths = [root, `${root}folder${path.sep}..`, 'relative.txt', 'sftp://example.test/']
  const result = await files.trash(paths, () => {}, async () => {
    assert.fail('Unsafe paths must not reach confirmation')
  })
  assert.equal(result.done, 0)
  assert.equal(result.errors.length, paths.length)
})

test('permanent-delete failure is reported and a failed confirmation never deletes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filedesk-trash-'))
  const missing = path.join(root, 'missing.txt'), file = path.join(root, 'original.txt')
  await fs.writeFile(file, 'original')
  try {
    const files = service()
    const result = await files.trash([missing], () => {}, async () => true)
    assert.equal(result.done, 0)
    assert.equal(result.errors[0].path, missing)
    assert.match(result.errors[0].message, /ENOENT/)
    await assert.rejects(files.trash([file], () => {}, async () => { throw Error('Dialog closed') }), /Dialog closed/)
    assert.equal(await fs.readFile(file, 'utf8'), 'original')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
