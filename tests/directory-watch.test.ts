import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { DirectoryWatches } from '../src/main/directory-watch'

test('local pane watches detect external file/folder changes, switch paths and close', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filedesk-watch-'))
  const left = path.join(root, 'left'), right = path.join(root, 'right')
  const events: { side: string; path: string }[] = []
  const watches = new DirectoryWatches((side, path) => events.push({ side, path }))
  const expectChange = async (side: string, dir: string, operation: () => Promise<unknown>) => {
    events.length = 0
    await operation()
    for (let i = 0; i < 60 && !events.some(e => e.side === side && e.path === dir); i++) await delay(50)
    assert.ok(events.some(e => e.side === side && e.path === dir), `${side}: ${dir}`)
    await delay(250)
  }
  try {
    await Promise.all([fs.mkdir(left), fs.mkdir(right)])
    watches.set('left', left)
    watches.set('right', right)
    await delay(300)
    const file = path.join(left, 'a.txt'), renamed = path.join(left, 'b.txt')
    await expectChange('left', left, () => fs.writeFile(file, 'a'))
    await expectChange('left', left, () => fs.appendFile(file, 'changed'))
    await expectChange('left', left, () => fs.rename(file, renamed))
    await expectChange('left', left, () => fs.unlink(renamed))
    await expectChange('right', right, () => fs.mkdir(path.join(right, 'folder')))
    await expectChange('right', right, () => fs.rmdir(path.join(right, 'folder')))

    watches.set('left', right)
    await delay(300)
    events.length = 0
    await fs.writeFile(path.join(left, 'old.txt'), 'old')
    await delay(350)
    assert.deepEqual(events, [], 'old directories stop notifying')
    await expectChange('left', right, () => fs.writeFile(path.join(right, 'both.txt'), 'both'))
    assert.ok(events.some(e => e.side === 'right'), 'both panes can watch the same directory')

    watches.set('left', 'sftp://example.test/')
    watches.set('right', path.join(root, 'missing'))
    events.length = 0
    await fs.writeFile(path.join(right, 'stopped.txt'), 'stopped')
    await delay(350)
    assert.deepEqual(events, [], 'remote/unavailable targets release old watches without throwing')

    watches.set('left', left)
    watches.close()
    await fs.writeFile(path.join(left, 'closed.txt'), 'closed')
    await delay(350)
    assert.deepEqual(events, [], 'closing cancels watches and pending notifications')
  } finally {
    watches.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
