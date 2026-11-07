import { Client as FtpClient } from 'basic-ftp'
import SftpClient from 'ssh2-sftp-client'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { TLSSocket, checkServerIdentity } from 'node:tls'
import { isIP } from 'node:net'
import type { ConnectRequest, FileEntry, ServerConnection, ServerProfile } from '@shared/types'
import { remoteName, remotePath, remoteUrl } from '@shared/remote-path'

type Trust = (host: string, fingerprint: string, kind: 'SSH' | 'TLS') => Promise<boolean>
interface Session {
  connection: ServerConnection
  ftp?: FtpClient
  sftp?: SftpClient
  queue: Promise<unknown>
  closed: boolean
}

export function normalizeProfile(input: ServerProfile): ServerProfile {
  const p = { ...input }
  if (!['ftp', 'ftps', 'ftps-implicit', 'sftp'].includes(p.protocol)) throw new Error('Unsupported protocol')
  p.host = p.host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!p.host || /[\s/@?#\r\n\0]/.test(p.host)) throw new Error('Invalid host. Enter a hostname or IP address.')
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) throw new Error('Invalid port (1–65535)')
  if (/[\r\n\0]/.test(p.username) || /[\r\n\0]/.test(p.remoteDir)) throw new Error('Invalid connection information')
  p.id = /^[a-zA-Z0-9-]{1,64}$/.test(p.id) ? p.id : randomUUID()
  p.name = p.name.trim() || p.host
  p.username = p.username || (p.protocol === 'sftp' ? '' : 'anonymous')
  if (!p.username) throw new Error('A username is required for SFTP')
  p.remoteDir = p.remoteDir.trim()
  p.privateKeyPath = p.protocol === 'sftp' ? p.privateKeyPath : ''
  delete p.hasPassword
  return p
}

export class RemoteManager {
  private sessions = new Map<string, Session>()
  constructor(private trust: Trust) {}

  connections(): ServerConnection[] {
    return [...this.sessions.values()].filter(s => !s.closed && !s.ftp?.closed).map(s => s.connection)
  }

  async connect(request: ConnectRequest): Promise<ServerConnection> {
    const p = normalizeProfile(request.profile)
    if (/[\r\n\0]/.test(request.password)) throw new Error('Password contains an unsupported control character')
    const host = p.host.includes(':') && !p.host.startsWith('[') ? `[${p.host}]` : p.host
    const root = `${p.protocol === 'ftps-implicit' ? 'ftps' : p.protocol}://${encodeURIComponent(p.username)}@${host}:${p.port}/`
    const s: Session = { connection: { id: p.id, name: p.name, root }, queue: Promise.resolve(), closed: false }
    try {
      if (p.protocol === 'sftp') {
        const client = new SftpClient('FileDesk', { error: () => { s.closed = true }, end: () => { s.closed = true } })
        s.sftp = client
        await client.connect({
          host: p.host.replace(/^\[|\]$/g, ''), port: p.port, username: p.username,
          password: request.password || undefined,
          privateKey: p.privateKeyPath ? await fs.readFile(p.privateKeyPath) : undefined,
          passphrase: request.passphrase || undefined, readyTimeout: 20000, keepaliveInterval: 15000,
          hostVerifier: (key: Buffer, done: (valid: boolean) => void) => {
            const fp = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
            void this.trust(`${p.host}:${p.port}`, fp, 'SSH').then(done, () => done(false))
          }
        })
        const dir = p.remoteDir ? await client.realPath(p.remoteDir) : await client.cwd()
        const stat = await client.stat(dir)
        if (!stat.isDirectory) throw new Error('The remote initial path is not a directory')
        s.connection.root = remoteUrl(root, dir)
      } else {
        const ftp = new FtpClient(30000)
        s.ftp = ftp
        // Complete TLS validation/explicit trust before sending login credentials.
        if (p.protocol === 'ftps-implicit') await ftp.connectImplicitTLS(p.host, p.port, { rejectUnauthorized: false })
        else {
          await ftp.connect(p.host, p.port)
          if (p.protocol === 'ftps') await ftp.useTLS({ rejectUnauthorized: false, ...(isIP(p.host) ? {} : { servername: p.host }) })
        }
        if (p.protocol !== 'ftp') {
          const socket = ftp.ftp.socket as TLSSocket
          const cert = socket.getPeerCertificate(true)
          if (!cert.raw) throw new Error('The server did not provide a TLS certificate')
          const fingerprint = `SHA256:${createHash('sha256').update(cert.raw).digest('base64')}`
          const trusted = socket.authorized && !checkServerIdentity(p.host, cert)
          if (!trusted && !await this.trust(`${p.host}:${p.port}`, fingerprint, 'TLS')) throw new Error('TLS certificate was not accepted')
          const pem = `-----BEGIN CERTIFICATE-----\n${cert.raw.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
          const pinned = {
            rejectUnauthorized: true, ca: pem, allowPartialTrustChain: true,
            checkServerIdentity: (_name: string, peer: import('node:tls').PeerCertificate) => peer.raw && createHash('sha256').update(peer.raw).digest('base64') === fingerprint.slice(7) ? undefined : new Error('TLS certificate changed')
          }
          // A TLS session resumed from an initially untrusted handshake retains that
          // verification result. Reconnect with the accepted certificate before login.
          ftp.close()
          if (p.protocol === 'ftps-implicit') await ftp.connectImplicitTLS(p.host, p.port, pinned)
          else { await ftp.connect(p.host, p.port); await ftp.useTLS(pinned) }
        }
        await ftp.login(p.username, request.password || (p.username === 'anonymous' ? 'guest' : ''))
        await ftp.useDefaultSettings()
        ftp.ftp.encoding = 'utf8'
        await ftp.sendIgnoringError('OPTS UTF8 ON')
        if (p.remoteDir) await ftp.cd(p.remoteDir)
        s.connection.root = remoteUrl(root, await ftp.pwd())
      }
      const key = remotePath(root).key
      const old = this.sessions.get(key)
      if (old) await this.close(old)
      this.sessions.set(key, s)
      return s.connection
    } catch (e) { await this.close(s); throw e }
  }

  private async close(s: Session): Promise<void> {
    s.closed = true
    s.ftp?.close()
    await s.sftp?.end().catch(() => {})
  }

  async disconnect(p: string): Promise<void> {
    const key = remotePath(p).key
    const s = this.sessions.get(key)
    if (s) { this.sessions.delete(key); await this.close(s) }
  }

  async closeAll(): Promise<void> { await Promise.all([...this.sessions.values()].map(s => this.close(s))); this.sessions.clear() }

  private async use<T>(p: string, fn: (s: Session, name: string) => Promise<T>): Promise<T> {
    const r = remotePath(p)
    const s = this.sessions.get(r.key)
    if (!s || s.closed || s.ftp?.closed) throw new Error('Server disconnected. Use Server → Connect to reconnect.')
    const job = s.queue.then(() => {
      if (s.closed) throw new Error('Server disconnected')
      return fn(s, r.path)
    })
    s.queue = job.catch(() => {})
    return job
  }

  async list(p: string): Promise<FileEntry[]> {
    return this.use(p, async (s, dir) => {
      const rows = s.sftp ? (await s.sftp.list(dir)).map(e => ({ name: e.name, isDir: e.type === 'd', isSymlink: e.type === 'l', size: e.size, mtime: e.modifyTime }))
        : (await s.ftp!.list(dir)).map(e => ({ name: e.name, isDir: e.isDirectory, isSymlink: e.isSymbolicLink, size: e.size, mtime: e.modifiedAt?.getTime() || 0 }))
      return rows.filter(e => e.name !== '.' && e.name !== '..').map(e => {
        if (!remoteName(e.name)) throw new Error('Server returned an unsafe filename')
        return { ...e, path: remoteUrl(p, path.posix.join(dir, e.name)), ext: e.isDir ? '' : path.posix.extname(e.name).slice(1), hidden: false, dot: e.name.startsWith('.') }
      })
    })
  }

  async stat(p: string): Promise<FileEntry | undefined> {
    const r = remotePath(p)
    if (r.path === '/') return { name: '/', path: p, isDir: true, isSymlink: false, size: 0, mtime: 0, ext: '', hidden: false, dot: false }
    return (await this.list(remoteUrl(p, path.posix.dirname(r.path)))).find(e => e.name === path.posix.basename(r.path))
  }

  async mkdir(p: string): Promise<void> {
    await this.use(p, async (s, name) => {
      if (s.sftp) await s.sftp.mkdir(name, false)
      else await s.ftp!.send(`MKD ${name}`)
    })
  }

  async rename(from: string, to: string): Promise<void> {
    if (remotePath(from).key !== remotePath(to).key) throw new Error('Cannot rename across servers')
    await this.use(from, async (s, name) => {
      if (s.sftp) await s.sftp.rename(name, remotePath(to).path)
      else await s.ftp!.rename(name, remotePath(to).path)
    })
  }

  async remove(p: string, directory: boolean): Promise<void> {
    if (remotePath(p).path === '/') throw new Error('Cannot delete a server root')
    await this.use(p, async (s, name) => {
      if (s.sftp) { if (directory) await s.sftp.rmdir(name, false); else await s.sftp.delete(name) }
      else if (directory) await s.ftp!.send(`RMD ${name}`)
      else await s.ftp!.remove(name)
    })
  }

  async download(p: string, local: string, progress: (n: number) => void): Promise<void> {
    await this.use(p, async (s, name) => {
      if (s.sftp) {
        const stream = s.sftp.createReadStream(name)
        let n = 0
        stream.on('data', (data: Buffer) => { n += data.length; progress(n) })
        const { pipeline } = await import('node:stream/promises')
        const { createWriteStream } = await import('node:fs')
        await pipeline(stream, createWriteStream(local, { flags: 'wx' }))
      } else {
        s.ftp!.trackProgress(p => { if (p.type === 'download') progress(p.bytes) })
        try { await s.ftp!.downloadTo(local, name) } finally { s.ftp!.trackProgress() }
      }
    })
  }

  async upload(local: string, p: string, progress: (n: number) => void): Promise<void> {
    await this.use(p, async (s, name) => {
      if (s.sftp) {
        const { createReadStream } = await import('node:fs')
        const stream = createReadStream(local)
        let n = 0
        stream.on('data', (data: Buffer) => { n += data.length; progress(n) })
        try { await s.sftp.put(stream, name) } finally { stream.destroy() }
      } else {
        s.ftp!.trackProgress(p => { if (p.type === 'upload') progress(p.bytes) })
        try { await s.ftp!.uploadFrom(local, name) } finally { s.ftp!.trackProgress() }
      }
    })
  }
}
