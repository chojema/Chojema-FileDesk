import { app, dialog, safeStorage } from 'electron'
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { RemoteManager, normalizeProfile } from './remote'
import type { ConnectRequest, Lang, ServerConnection, ServerProfile } from '@shared/types'

interface StoredProfile extends ServerProfile { secret?: string }
interface Store { profiles: StoredProfile[]; trusted: Record<string, string> }
const location = () => path.join(app.getPath('userData'), 'servers.json')
function read(): Store {
  try {
    const v = JSON.parse(readFileSync(location(), 'utf8'))
    return { profiles: Array.isArray(v.profiles) ? v.profiles : [], trusted: v.trusted || {} }
  } catch { return { profiles: [], trusted: {} } }
}
let writes = Promise.resolve()
function save(edit: (v: Store) => void): Promise<void> {
  const operation = writes.then(async () => {
    const store = read(); edit(store)
    await fs.mkdir(path.dirname(location()), { recursive: true })
    await fs.writeFile(location() + '.tmp', JSON.stringify(store, null, 2), { mode: 0o600 })
    await fs.rename(location() + '.tmp', location())
  })
  writes = operation.catch(() => {})
  return operation
}

// Reuse a stored credential only for the same server/user/authentication method.
const sameLogin = (a: ServerProfile, b: ServerProfile): boolean =>
  a.host === b.host && a.port === b.port && a.username === b.username && a.protocol === b.protocol && a.privateKeyPath === b.privateKeyPath

export function createConnections(language: () => Lang): {
  manager: RemoteManager
  profiles: () => ServerProfile[]
  remove: (id: string) => Promise<void>
  saveProfile: (request: ConnectRequest) => Promise<ServerProfile>
  connect: (request: ConnectRequest) => Promise<ServerConnection>
} {
  const manager = new RemoteManager(async (host, fingerprint, kind) => {
    const key = `${kind}:${host}`
    const previous = read().trusted[key]
    if (previous === fingerprint) return true
    const ko = language() === 'ko'
    const result = await dialog.showMessageBox({
      type: previous ? 'warning' : 'question',
      title: ko ? `${kind} 서버 확인` : `Verify ${kind} server`,
      message: ko ? (previous ? '서버의 인증 정보가 이전과 달라졌습니다.' : '서버의 인증 정보를 확인하세요.') : (previous ? 'The server identity has changed.' : 'Verify this server before connecting.'),
      detail: `${host}\n\n${fingerprint}${previous ? `\n\n${ko ? '이전' : 'Previous'}: ${previous}` : ''}\n\n${ko ? '서버 관리자가 제공한 지문과 일치할 때만 신뢰하고 연결하세요.' : 'Trust and connect only if this fingerprint matches the one provided by the server administrator.'}`,
      buttons: ko ? ['취소', '신뢰하고 연결'] : ['Cancel', 'Trust and Connect'],
      defaultId: 0, cancelId: 0, noLink: true
    })
    if (result.response !== 1) return false
    await save(s => { s.trusted[key] = fingerprint })
    return true
  })
  return {
    manager,
    profiles: () => read().profiles.map(({ secret, ...p }) => ({ ...p, hasPassword: !!secret })),
    remove: id => save(s => { s.profiles = s.profiles.filter(p => p.id !== id) }),
    saveProfile: async request => {
      const profile = normalizeProfile(request.profile)
      const previous = read().profiles.find(p => p.id === profile.id)
      let secret: string | undefined
      if (profile.rememberPassword && (request.password || request.passphrase)) {
        if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error(language() === 'ko' ? '운영체제의 보안 저장소를 사용할 수 없습니다. 암호 저장을 끄고 저장하세요.' : 'Secure OS storage is unavailable. Turn off Remember Password to save.')
        secret = safeStorage.encryptString(JSON.stringify({ password: request.password, passphrase: request.passphrase })).toString('base64')
      } else if (profile.rememberPassword && !request.password && !request.passphrase && previous?.secret && sameLogin(previous, profile)) secret = previous.secret
      await save(s => { s.profiles = [...s.profiles.filter(p => p.id !== profile.id), { ...profile, secret }] })
      return { ...profile, hasPassword: !!secret }
    },
    connect: async request => {
      const profile = normalizeProfile(request.profile)
      let password = request.password, passphrase = request.passphrase
      const previous = read().profiles.find(p => p.id === profile.id)
      if (!password && !passphrase && previous?.secret && sameLogin(previous, profile)) {
        try {
          const stored = JSON.parse(safeStorage.decryptString(Buffer.from(previous.secret, 'base64')))
          password = stored.password || ''; passphrase = stored.passphrase || ''
        } catch { throw new Error(language() === 'ko' ? '저장한 암호를 읽을 수 없습니다. 암호를 다시 입력하세요.' : 'Cannot read the saved credential. Enter it again.') }
      }
      let secret: string | undefined
      if (request.saveProfile && profile.rememberPassword && (password || passphrase)) {
        if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error(language() === 'ko' ? '운영체제의 보안 저장소를 사용할 수 없습니다. 암호 저장을 끄고 연결하세요.' : 'Secure OS storage is unavailable. Turn off Remember Password to connect.')
        secret = safeStorage.encryptString(JSON.stringify({ password, passphrase })).toString('base64')
      }
      const connection = await manager.connect({ ...request, profile, password, passphrase })
      if (request.saveProfile) {
        try { await save(s => { s.profiles = [...s.profiles.filter(p => p.id !== profile.id), { ...profile, secret }] }) }
        catch (e) { await manager.disconnect(connection.root); throw e }
      }
      return connection
    }
  }
}
