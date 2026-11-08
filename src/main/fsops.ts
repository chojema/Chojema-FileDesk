import { app, shell } from 'electron'
import { promises as fsp, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { copyName } from '@shared/copy-name'
import type {
  DirListing,
  DiskSpace,
  FileEntry,
  Place,
  Progress,
  Result,
  TransferRequest,
  TransferResult
} from '@shared/types'

const isWin = process.platform === 'win32'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function samePath(a: string, b: string): boolean {
  const na = path.resolve(a)
  const nb = path.resolve(b)
  return isWin || process.platform === 'darwin' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const WIN_SYSTEM_ROOT_ENTRIES = new Set([
  '$recycle.bin',
  'system volume information',
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'dumpstack.log.tmp',
  'recovery',
  'config.msi'
])

function isWinSystemRootEntry(full: string, name: string): boolean {
  return WIN_SYSTEM_ROOT_ENTRIES.has(name.toLowerCase()) && path.dirname(full) === path.parse(full).root
}

function runTool(file: string, args: string[], verbatim = false): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', timeout: 4000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, windowsVerbatimArguments: verbatim },
      // "dir" exits non-zero when nothing matches; partial output is still usable.
      (_err, stdout) => resolve(stdout ?? '')
    )
  })
}

/**
 * Names in `dir` that carry the OS "hidden" attribute.
 * Node has no file-attribute API, so ask the OS once per listing instead of once per file.
 */
async function hiddenNames(dir: string): Promise<Set<string>> {
  try {
    if (isWin) {
      // cmd would expand %VAR% inside the path; skip attribute detection for such (rare) paths.
      if (dir.includes('%')) return new Set()
      const out = await runTool('cmd.exe', ['/d', '/s', '/c', `"chcp 65001>nul & dir /a:h /b "${dir}""`], true)
      return new Set(out.split(/\r?\n/).filter(Boolean))
    }
    if (process.platform === 'darwin') {
      const out = await runTool('/usr/bin/find', [dir, '-mindepth', '1', '-maxdepth', '1', '-flags', '+hidden', '-print0'])
      return new Set(out.split('\0').filter(Boolean).map((p) => path.basename(p)))
    }
  } catch {
    /* attribute detection is best-effort */
  }
  return new Set()
}

export async function listDir(dir: string): Promise<Result<DirListing>> {
  try {
    const abs = path.resolve(dir)
    const [dirents, hiddenSet] = await Promise.all([fsp.readdir(abs, { withFileTypes: true }), hiddenNames(abs)])
    const entries: FileEntry[] = []
    await Promise.all(
      dirents.map(async (d) => {
        const full = path.join(abs, d.name)
        let isDir = d.isDirectory()
        const isSymlink = d.isSymbolicLink()
        let size = 0
        let mtime = 0
        try {
          const st = await fsp.stat(full)
          isDir = st.isDirectory()
          size = isDir ? 0 : st.size
          mtime = st.mtimeMs
        } catch {
          // Broken link or no permission: keep the entry with what readdir gave us.
        }
        const dot = d.name.startsWith('.')
        const hidden = hiddenSet.has(d.name) || (isWin && isWinSystemRootEntry(full, d.name))
        const ext = isDir ? '' : path.extname(d.name).slice(1)
        entries.push({ name: d.name, path: full, isDir, isSymlink, size, mtime, ext, dot, hidden })
      })
    )
    const parentDir = path.dirname(abs)
    return { ok: true, value: { path: abs, parent: parentDir === abs ? null : parentDir, entries } }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export async function places(labels: Record<'home' | 'desktop' | 'documents' | 'downloads', string>): Promise<Place[]> {
  const out: Place[] = []
  const add = (id: string, label: string, p: string, kind: Place['kind']) => {
    if (p && existsSync(p)) out.push({ id, label, path: p, kind })
  }
  add('home', labels.home, os.homedir(), 'home')
  add('desktop', labels.desktop, app.getPath('desktop'), 'folder')
  add('documents', labels.documents, app.getPath('documents'), 'folder')
  add('downloads', labels.downloads, app.getPath('downloads'), 'folder')

  if (isWin) {
    // Checked in parallel off the main thread. Missing letters fail at once; a mapped network
    // drive that does not answer within a second is still listed, as Explorer does.
    const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
    const found = await Promise.all(letters.map(letter => Promise.race([
      fsp.access(`${letter}:\\`).then(() => true, () => false),
      new Promise<boolean>(resolve => setTimeout(() => resolve(true), 1000))
    ])))
    letters.forEach((letter, i) => { if (found[i]) out.push({ id: `drive-${letter}`, label: `${letter}:`, path: `${letter}:\\`, kind: 'drive' }) })
  } else {
    add('root', '/', '/', 'volume')
    if (process.platform === 'darwin') {
      try {
        for (const name of await fsp.readdir('/Volumes')) {
          const p = path.join('/Volumes', name)
          try {
            // Skip the boot volume alias (a symlink to "/").
            if ((await fsp.lstat(p)).isSymbolicLink()) continue
          } catch {
            continue
          }
          add(`vol-${name}`, name, p, 'volume')
        }
      } catch {
        /* no /Volumes */
      }
    }
  }
  return out
}

export async function diskSpace(p: string): Promise<DiskSpace | null> {
  try {
    const st = await fsp.statfs(p)
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize }
  } catch {
    return null
  }
}

export async function resolveInput(input: string, base: string): Promise<Result<string>> {
  let p = input.trim().replace(/^"(.*)"$/, '$1')
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1))
  if (isWin && /^[a-zA-Z]:$/.test(p)) p += '\\'
  const abs = path.resolve(base, p)
  try {
    const st = await fsp.stat(abs)
    return st.isDirectory() ? { ok: true, value: abs } : { ok: true, value: path.dirname(abs) }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export async function findConflicts(sources: string[], destDir: string): Promise<string[]> {
  const out: string[] = []
  for (const s of sources) {
    const target = path.join(destDir, path.basename(s))
    if (!samePath(s, target) && existsSync(target)) out.push(path.basename(s))
  }
  return out
}

async function moveOne(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw e
    // Different volume (or existing target directory): copy then remove.
    await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false, preserveTimestamps: true, verbatimSymlinks: true })
    await fsp.rm(src, { recursive: true, force: true })
  }
}

export async function transfer(req: TransferRequest, onProgress: (p: Progress) => void): Promise<TransferResult> {
  const result: TransferResult = { done: 0, skipped: 0, errors: [], created: [] }
  const total = req.sources.length
  for (let i = 0; i < total; i++) {
    const src = req.sources[i]
    const name = path.basename(src)
    const dest = path.join(req.destDir, name)
    onProgress({ current: name, index: i, total })
    try {
      if (samePath(src, dest)) {
        // Copying into its own folder makes a copy under a new name, as Explorer and Finder do.
        if (req.op !== 'copy') { result.skipped++; continue }
        const isDir = (await fsp.lstat(src)).isDirectory()
        let n = 1, target = ''
        do target = path.join(req.destDir, copyName(name, isDir, n++, process.platform, req.lang ?? 'en'))
        while (existsSync(target))
        await fsp.cp(src, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true })
        result.created!.push(target)
        result.done++
        continue
      }
      if (isInside(req.destDir, src) || samePath(req.destDir, src)) {
        result.errors.push({ path: src, message: 'into-self' })
        continue
      }
      if (existsSync(dest)) {
        if (req.policy === 'skip') {
          result.skipped++
          continue
        }
        // Overwrite: replace a file outright; merge into an existing directory.
        const destIsDir = (await fsp.stat(dest)).isDirectory()
        const srcIsDir = (await fsp.stat(src)).isDirectory()
        if (destIsDir !== srcIsDir) await fsp.rm(dest, { recursive: true, force: true })
      }
      if (req.op === 'copy') {
        await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false, preserveTimestamps: true, verbatimSymlinks: true })
      } else {
        await moveOne(src, dest)
      }
      result.done++
    } catch (e) {
      result.errors.push({ path: src, message: errMsg(e) })
    }
  }
  onProgress({ current: '', index: total, total })
  return result
}

const INVALID_NAME = isWin ? /[<>:"/\\|?*\x00-\x1f]|^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$|[. ]$/i : /[/\x00]/

export function validName(name: string): boolean {
  const n = name.trim()
  return n.length > 0 && n !== '.' && n !== '..' && !INVALID_NAME.test(n)
}

export async function mkdir(parent: string, name: string): Promise<Result<string>> {
  if (!validName(name)) return { ok: false, error: 'invalid-name' }
  const p = path.join(parent, name.trim())
  try {
    await fsp.mkdir(p)
    return { ok: true, value: p }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export async function rename(p: string, newName: string): Promise<Result<string>> {
  if (!validName(newName)) return { ok: false, error: 'invalid-name' }
  const dest = path.join(path.dirname(p), newName.trim())
  try {
    // Allow case-only renames on case-insensitive file systems.
    if (existsSync(dest) && !samePath(p, dest)) return { ok: false, error: 'EEXIST' }
    await fsp.rename(p, dest)
    return { ok: true, value: dest }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export async function trash(paths: string[], onProgress: (p: Progress) => void): Promise<TransferResult> {
  const result: TransferResult = { done: 0, skipped: 0, errors: [] }
  for (let i = 0; i < paths.length; i++) {
    onProgress({ current: path.basename(paths[i]), index: i, total: paths.length })
    try {
      await shell.trashItem(paths[i])
      result.done++
    } catch (e) {
      result.errors.push({ path: paths[i], message: errMsg(e) })
    }
  }
  onProgress({ current: '', index: paths.length, total: paths.length })
  return result
}

export async function dirSize(p: string, limit = 200_000): Promise<number> {
  let total = 0
  let count = 0
  const stack = [p]
  while (stack.length && count < limit) {
    const cur = stack.pop()!
    let items
    try {
      items = await fsp.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const it of items) {
      count++
      const full = path.join(cur, it.name)
      if (it.isDirectory()) stack.push(full)
      else if (it.isFile()) {
        try {
          total += (await fsp.stat(full)).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total
}
