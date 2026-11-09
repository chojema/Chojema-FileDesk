import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type * as Local from './fsops'
import { RemoteManager } from './remote'
import { isRemotePath, remoteName, remotePath, remoteUrl } from '@shared/remote-path'
import { copyName } from '@shared/copy-name'
import type { DirListing, FileEntry, Progress, Result, TransferRequest, TransferResult } from '@shared/types'

const message = (e: unknown): string => e instanceof Error ? e.message : String(e)
export const itemName = (p: string): string => isRemotePath(p) ? path.posix.basename(remotePath(p).path) : path.basename(p)
export const joinItem = (p: string, name: string): string => isRemotePath(p) ? remoteUrl(p, path.posix.join(remotePath(p).path, name)) : path.join(p, name)
const parent = (p: string): string => isRemotePath(p) ? remoteUrl(p, path.posix.dirname(remotePath(p).path)) : path.dirname(p)
const equal = (a: string, b: string): boolean => {
  if (isRemotePath(a) || isRemotePath(b)) return isRemotePath(a) && isRemotePath(b) && remotePath(a).key === remotePath(b).key && path.posix.normalize(remotePath(a).path) === path.posix.normalize(remotePath(b).path)
  return process.platform === 'linux' ? path.resolve(a) === path.resolve(b) : path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}
const inside = (child: string, base: string): boolean => {
  if (isRemotePath(child) !== isRemotePath(base)) return false
  if (isRemotePath(child) && remotePath(child).key !== remotePath(base).key) return false
  const api = isRemotePath(child) ? path.posix : path
  const rel = api.relative(isRemotePath(base) ? remotePath(base).path : base, isRemotePath(child) ? remotePath(child).path : child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel)
}

export class FileService {
  private transferring = false
  constructor(private local: typeof Local, readonly remote: RemoteManager) {}

  async list(p: string): Promise<Result<DirListing>> {
    if (!isRemotePath(p)) return this.local.listDir(p)
    try {
      const name = path.posix.resolve('/', remotePath(p).path)
      const normalized = remoteUrl(p, name)
      return { ok: true, value: { path: normalized, parent: name === '/' ? null : parent(normalized), entries: await this.remote.list(normalized) } }
    } catch (e) { return { ok: false, error: message(e) } }
  }

  async stat(p: string): Promise<FileEntry | undefined> {
    if (isRemotePath(p)) return this.remote.stat(p)
    try {
      const s = await fs.lstat(p)
      return { name: path.basename(p), path: p, isDir: s.isDirectory(), isSymlink: s.isSymbolicLink(), size: s.size, mtime: s.mtimeMs, ext: path.extname(p).slice(1), hidden: false, dot: path.basename(p).startsWith('.') }
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e }
  }

  async resolve(input: string, base: string): Promise<Result<string>> {
    if (!isRemotePath(input) && !isRemotePath(base)) return this.local.resolveInput(input, base)
    try {
      const target = isRemotePath(input) ? remoteUrl(input, path.posix.resolve('/', remotePath(input).path))
        : remoteUrl(base, path.posix.resolve(remotePath(base).path, input.trim()))
      const info = await this.stat(target)
      if (!info) return { ok: false, error: 'Path not found' }
      return { ok: true, value: info.isDir ? target : parent(target) }
    } catch (e) { return { ok: false, error: message(e) } }
  }

  async conflicts(sources: string[], dest: string): Promise<string[]> {
    const out: string[] = []
    for (const src of sources) {
      const target = joinItem(dest, itemName(src))
      if (!equal(src, target) && await this.stat(target)) out.push(itemName(src))
    }
    return out
  }

  async mkdir(p: string, name: string): Promise<Result<string>> {
    if (!isRemotePath(p)) return this.local.mkdir(p, name)
    if (!remoteName(name.trim())) return { ok: false, error: 'invalid-name' }
    try { const dest = joinItem(p, name.trim()); await this.remote.mkdir(dest); return { ok: true, value: dest } }
    catch (e) { return { ok: false, error: message(e) } }
  }

  async rename(p: string, name: string): Promise<Result<string>> {
    if (!isRemotePath(p)) return this.local.rename(p, name)
    if (!remoteName(name.trim())) return { ok: false, error: 'invalid-name' }
    try {
      const dest = joinItem(parent(p), name.trim())
      if (equal(p, dest)) return { ok: true, value: p }
      if (await this.stat(dest)) return { ok: false, error: 'EEXIST' }
      await this.remote.rename(p, dest)
      return { ok: true, value: dest }
    } catch (e) { return { ok: false, error: message(e) } }
  }

  private async remove(p: string, depth = 0): Promise<void> {
    if (depth > 128) throw new Error('Folder nesting is too deep')
    if (!isRemotePath(p)) { await fs.rm(p, { recursive: true }); return }
    if (remotePath(p).path === '/') throw new Error('Cannot delete a server root')
    const info = await this.stat(p)
    if (!info) return
    if (info.isDir && !info.isSymlink) for (const child of await this.remote.list(p)) await this.remove(child.path, depth + 1)
    await this.remote.remove(p, info.isDir && !info.isSymlink)
  }

  async trash(paths: string[], progress: (p: Progress) => void, confirmPermanentDelete?: (paths: string[]) => Promise<boolean>): Promise<TransferResult> {
    const out: TransferResult = { done: 0, skipped: 0, errors: [] }
    for (const [i, p] of paths.entries()) {
      progress({ current: itemName(p), index: i, total: paths.length })
      try {
        if (isRemotePath(p)) { await this.remove(p); out.done++ }
        else { const r = await this.local.trash([p], () => {}); out.done += r.done; out.errors.push(...r.errors) }
      } catch (e) { out.errors.push({ path: p, message: message(e) }) }
    }
    const failed = out.errors.filter(e => !isRemotePath(e.path) && path.isAbsolute(e.path) && path.dirname(path.resolve(e.path)) !== path.resolve(e.path))
    if (failed.length && confirmPermanentDelete && await confirmPermanentDelete(failed.map(e => e.path))) {
      for (const [i, error] of failed.entries()) {
        progress({ current: itemName(error.path), index: i, total: failed.length })
        try {
          await this.remove(error.path)
          out.done++
          out.errors.splice(out.errors.indexOf(error), 1)
        } catch (e) { error.message = message(e) }
      }
    }
    progress({ current: '', index: paths.length, total: paths.length })
    return out
  }

  private async copy(src: string, dest: string, onBytes: (name: string, n: number) => void, depth = 0): Promise<void> {
    if (depth > 128) throw new Error('Folder nesting is too deep')
    const item = await this.stat(src)
    if (!item) throw new Error('Source no longer exists')
    if (item.isSymlink) throw new Error('Transfers involving a server do not follow symbolic links. Select the target file or folder instead.')
    let existing = await this.stat(dest)
    if (existing?.isSymlink) throw new Error('The destination is a symbolic link')
    if (item.isDir) {
      if (existing && !existing.isDir) { await this.remove(dest); existing = undefined }
      if (!existing) {
        if (isRemotePath(dest)) await this.remote.mkdir(dest)
        else await fs.mkdir(dest)
      }
      const listing = await this.list(src)
      if (!listing.ok || !listing.value) throw new Error(listing.error || 'Cannot read folder')
      for (const child of listing.value.entries) await this.copy(child.path, joinItem(dest, child.name), onBytes, depth + 1)
      return
    }
    if (existing?.isDir) throw new Error('A folder already exists at the file destination; rename it before transferring')
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'filedesk-transfer-'))
    let staging = ''
    let backup = ''
    try {
      let local = src
      if (isRemotePath(src)) {
        local = path.join(work, 'download')
        await this.remote.download(src, local, n => onBytes(item.name, n))
        if ((await fs.stat(local)).size !== item.size) throw new Error('Download size does not match the server listing; source was kept')
      }
      if (isRemotePath(dest)) {
        staging = joinItem(parent(dest), `.filedesk-${randomUUID()}.part`)
        await this.remote.upload(local, staging, n => onBytes(item.name, n))
        const uploaded = await this.stat(staging)
        if (!uploaded || uploaded.size !== (await fs.stat(local)).size) throw new Error('Upload size verification failed; source was kept')
        if (existing) {
          backup = joinItem(parent(dest), `.filedesk-${randomUUID()}.backup`)
          await this.remote.rename(dest, backup)
        }
        try { await this.remote.rename(staging, dest); staging = '' }
        catch (e) { if (backup) { await this.remote.rename(backup, dest); backup = '' }; throw e }
        if (backup) { await this.remote.remove(backup, false); backup = '' }
      } else {
        staging = path.join(parent(dest), `.filedesk-${randomUUID()}.part`)
        await fs.copyFile(local, staging, 1)
        await fs.rename(staging, dest)
        staging = ''
      }
    } finally {
      if (staging) {
        if (isRemotePath(staging)) await this.remote.remove(staging, false).catch(() => {})
        else await fs.rm(staging, { force: true }).catch(() => {})
      }
      await fs.rm(work, { recursive: true, force: true })
    }
  }

  async transfer(req: TransferRequest, progress: (p: Progress) => void): Promise<TransferResult> {
    if (!isRemotePath(req.destDir) && req.sources.every(p => !isRemotePath(p))) return this.local.transfer(req, progress)
    const out: TransferResult = { done: 0, skipped: 0, errors: [], created: [] }
    if (this.transferring) return { ...out, errors: [{ path: req.destDir, message: 'Another transfer is in progress' }] }
    this.transferring = true
    try {
      const destination = await this.stat(req.destDir)
      if (!destination?.isDir || destination.isSymlink) throw new Error('Destination is not a directory')
      for (const [i, src] of req.sources.entries()) {
        const dest = joinItem(req.destDir, itemName(src))
        progress({ current: itemName(src), index: i, total: req.sources.length })
        try {
          if (equal(src, dest)) {
            if (req.op !== 'copy') { out.skipped++; continue }
            const info = await this.stat(src)
            let n = 1, target = ''
            do target = joinItem(req.destDir, copyName(itemName(src), !!info?.isDir, n++, process.platform, req.lang ?? 'en'))
            while (await this.stat(target))
            await this.copy(src, target, (name, bytes) => progress({ current: name, index: i, total: req.sources.length, bytes }))
            out.created!.push(target)
            out.done++
            continue
          }
          if (equal(src, req.destDir) || inside(req.destDir, src)) { out.errors.push({ path: src, message: 'into-self' }); continue }
          const existing = await this.stat(dest)
          if (existing && req.policy === 'skip') { out.skipped++; continue }
          if (req.op === 'move' && !existing && isRemotePath(src) && isRemotePath(dest) && remotePath(src).key === remotePath(dest).key) {
            await this.remote.rename(src, dest)
          } else {
            await this.copy(src, dest, (name, bytes) => progress({ current: name, index: i, total: req.sources.length, bytes }))
            // Delete a source only after every descendant was successfully transferred.
            if (req.op === 'move') await this.remove(src)
          }
          out.done++
        } catch (e) { out.errors.push({ path: src, message: message(e) }) }
      }
    } catch (e) { out.errors.push({ path: req.destDir, message: message(e) }) }
    finally { this.transferring = false; progress({ current: '', index: req.sources.length, total: req.sources.length }) }
    return out
  }

  async dirSize(p: string, depth = 0): Promise<number> {
    if (!isRemotePath(p)) return this.local.dirSize(p)
    if (depth > 128) throw new Error('Folder nesting is too deep')
    let size = 0
    for (const e of await this.remote.list(p)) if (!e.isSymlink) size += e.isDir ? await this.dirSize(e.path, depth + 1) : e.size
    return size
  }
}
