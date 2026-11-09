import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { isRemotePath } from '../shared/remote-path'
import type { PaneSide } from '../shared/types'

/** At most one local folder per pane; never watches descendants or server URLs. */
export class DirectoryWatches {
  private panes = new Map<PaneSide, { path: string; watcher: FSWatcher; timer?: NodeJS.Timeout }>()

  constructor(private changed: (side: PaneSide, path: string) => void) {}

  set(side: PaneSide, dir: string): void {
    if (this.panes.get(side)?.path === dir) return
    this.remove(side)
    if (!path.isAbsolute(dir) || isRemotePath(dir)) return
    try {
      const watcher = watch(dir, () => notify())
      const entry = { path: dir, watcher, timer: undefined as NodeJS.Timeout | undefined }
      const notify = () => {
        // A fixed window also delivers updates during a continuous stream of writes.
        entry.timer ??= setTimeout(() => {
          entry.timer = undefined
          if (this.panes.get(side) === entry) this.changed(side, dir)
        }, 200)
      }
      this.panes.set(side, entry)
      watcher.on('error', () => {
        if (this.panes.get(side) !== entry) return
        this.remove(side)
        this.changed(side, dir)
      })
      notify() // Cover changes between the initial listing and watcher registration.
    } catch { /* Unavailable folders retain manual/focus refresh. */ }
  }

  private remove(side: PaneSide): void {
    const entry = this.panes.get(side)
    if (!entry) return
    clearTimeout(entry.timer)
    entry.watcher.close()
    this.panes.delete(side)
  }

  close(): void {
    for (const side of this.panes.keys()) this.remove(side)
  }
}
