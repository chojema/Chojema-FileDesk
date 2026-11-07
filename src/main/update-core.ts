import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateInfo, UpdateProgress } from '@shared/types'

export const RELEASE_API = 'https://api.github.com/repos/chojema/Chojema-FileDesk/releases/latest'
export const RELEASES_URL = 'https://github.com/chojema/Chojema-FileDesk/releases'
export interface ReleaseAsset { name: string; browser_download_url: string; size: number; digest?: string }
export interface Release { tag_name: string; html_url: string; body: string; draft: boolean; prerelease: boolean; assets: ReleaseAsset[] }
const version = (v: string): number[] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)
  if (!match) return null
  const parts = match.slice(1).map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}
export function newer(latest: string, current: string): boolean {
  const a = version(latest), b = version(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
export function assetUrl(asset: ReleaseAsset, tag: string): string {
  const expected = `https://github.com/chojema/Chojema-FileDesk/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`
  if (asset.browser_download_url !== expected) throw new Error('Unexpected release download URL')
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2_500_000_000) throw new Error('Invalid release asset size')
  return expected
}
export function selectUpdate(release: Release, current: string, platform: string, arch: string, portable = false): { info: UpdateInfo; asset?: ReleaseAsset } {
  if (!version(release.tag_name) || release.draft || release.prerelease || !Array.isArray(release.assets)) throw new Error('Invalid stable release information')
  const latest = release.tag_name.replace(/^v/, '')
  const url = `https://github.com/chojema/Chojema-FileDesk/releases/tag/${release.tag_name}`
  if (release.html_url !== url) throw new Error('Unexpected release URL')
  const suffix = platform === 'darwin' ? `mac-${arch}.dmg` : platform === 'win32' ? `win-${arch}-${portable ? 'portable' : 'setup'}.exe` : ''
  const name = `Chojema-FileDesk-${latest}-${suffix}`
  const asset = suffix ? release.assets.find(a => a.name === name) : undefined
  if (asset) assetUrl(asset, release.tag_name)
  return { asset, info: { available: newer(latest, current), current, latest, url, notes: String(release.body || '').slice(0, 30000), assetName: asset?.name, size: asset?.size } }
}
export async function checkedDownload(response: Response, target: string, expectedSize: number, expectedHash: string, progress: (p: UpdateProgress) => void): Promise<void> {
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) throw new Error('Missing SHA-256 checksum')
  const hash = createHash('sha256')
  let received = 0
  const meter = new Transform({ transform(chunk, _encoding, cb) {
    received += chunk.length
    if (received > expectedSize) { cb(new Error('Download exceeds the expected size')); return }
    hash.update(chunk); progress({ received, total: expectedSize }); cb(null, chunk)
  } })
  let created = false
  const output = createWriteStream(target, { flags: 'wx', mode: 0o600 })
  output.once('open', () => { created = true })
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter, output)
    if (received !== expectedSize || hash.digest('hex') !== expectedHash.toLowerCase()) throw new Error('Downloaded file failed SHA-256 or size verification')
  } catch (e) { if (created) await fs.rm(target, { force: true }); throw e }
}
