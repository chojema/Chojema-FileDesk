import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { RELEASE_API, assetUrl, checkedDownload, selectUpdate } from './update-core'
import type { Release } from './update-core'
import type { UpdateInfo, UpdateProgress } from '@shared/types'

let release: Release | undefined
let busy = false
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Chojema-FileDesk' }
export async function checkUpdate(): Promise<UpdateInfo> {
  const response = await fetch(RELEASE_API, { headers, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub request limit reached. Try again later.' : `GitHub release check failed (${response.status})`)
  const next = await response.json() as Release
  const selected = selectUpdate(next, app.getVersion(), process.platform, process.arch, !!process.env.PORTABLE_EXECUTABLE_FILE)
  release = next
  return selected.info
}
export async function downloadUpdate(progress: (p: UpdateProgress) => void): Promise<string> {
  if (busy) throw new Error('An update download is already in progress')
  if (!release) throw new Error('Check for updates first')
  const { info, asset } = selectUpdate(release, app.getVersion(), process.platform, process.arch, !!process.env.PORTABLE_EXECUTABLE_FILE)
  if (!info.available || !asset) throw new Error('No compatible update is available')
  busy = true
  let work = ''
  try {
    let checksum = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]
    if (!checksum) {
      const sums = release.assets.find(a => a.name === 'SHA256SUMS.txt')
      if (!sums || sums.size > 100000) throw new Error('This release has no SHA-256 checksum')
      const res = await fetch(assetUrl(sums, release.tag_name), { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error('Cannot download release checksums')
      checksum = (await res.text()).split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).find(m => m?.[2] === asset.name)?.[1]
      if (!checksum) throw new Error('No checksum for this installer')
    }
    work = await fs.mkdtemp(path.join(app.getPath('temp'), 'filedesk-update-'))
    const target = path.join(work, asset.name)
    const response = await fetch(assetUrl(asset, release.tag_name), { signal: AbortSignal.timeout(30 * 60 * 1000) })
    await checkedDownload(response, target, asset.size, checksum, progress)
    let installer = target
    // A portable build is replaced by placing the new executable next to the current one.
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    if (portableDir) {
      const beside = path.join(portableDir, asset.name)
      try { await fs.copyFile(target, beside); installer = beside } catch { /* keep the verified temp copy */ }
    }
    const error = await shell.openPath(installer)
    if (error) throw new Error(error)
    // Quit so the installer (or Finder on macOS) can replace the running app.
    setTimeout(() => app.quit(), 1500)
    return installer
  } catch (e) { if (work) await fs.rm(work, { recursive: true, force: true }); throw e }
  finally { busy = false }
}
