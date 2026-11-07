import type { PaneSide, ServerConnection, ServerProfile, ServerProtocol } from '@shared/types'
import { alertBox, busy, choose } from './dialogs'
import { api, el, t } from './util'

const defaults = (): ServerProfile => ({ id: '', name: '', protocol: 'ftps', host: '', port: 21, username: '', remoteDir: '', privateKeyPath: '', rememberPassword: false })
const portFor = (p: string): number => p === 'sftp' ? 22 : p === 'ftps-implicit' ? 990 : 21

export async function connectDialog(): Promise<{ connection: ServerConnection; side: PaneSide } | null> {
  let profiles = await api.serverProfiles()
  let profile = defaults()
  let password = '', passphrase = '', saveProfile = true, side: PaneSide = 'right'
  while (true) {
    const saved = el('select', { id: 'server-saved' })
    saved.append(el('option', { value: '', textContent: t('server.new') }))
    profiles.forEach(p => saved.append(el('option', { value: p.id, textContent: `${p.name} · ${p.protocol.toUpperCase()}`, selected: p.id === profile.id })))
    const name = el('input', { type: 'text', id: 'server-name', value: profile.name })
    const protocol = el('select', { id: 'server-protocol' })
    ;([['ftps', 'FTPS · TLS'], ['sftp', 'SFTP · SSH'], ['ftp', 'FTP · No TLS'], ['ftps-implicit', 'FTPS · Implicit TLS']] as const).forEach(([value, label]) => protocol.append(el('option', { value, textContent: label, selected: value === profile.protocol })))
    const host = el('input', { type: 'text', id: 'server-host', value: profile.host, placeholder: 'server.example.com / sftp://user@host:22/folder', autocomplete: 'off' })
    const port = el('input', { type: 'number', id: 'server-port', value: String(profile.port), min: '1', max: '65535' })
    const username = el('input', { type: 'text', id: 'server-user', value: profile.username, autocomplete: 'off' })
    const secret = el('input', { type: 'password', id: 'server-password', value: password, autocomplete: 'off', placeholder: profile.hasPassword ? t('server.savedPassword') : '' })
    const dir = el('input', { type: 'text', id: 'server-path', value: profile.remoteDir, placeholder: '/' })
    const key = el('input', { type: 'text', id: 'server-key', value: profile.privateKeyPath })
    const pick = el('button', { type: 'button', class: 'btn', title: t('server.keyPick'), textContent: '…' })
    pick.addEventListener('click', () => { void api.pickPrivateKey().then(p => { if (p) key.value = p }) })
    const phrase = el('input', { type: 'password', id: 'server-passphrase', value: passphrase, autocomplete: 'off' })
    const save: HTMLInputElement = el('input', { type: 'checkbox', id: 'server-save', checked: saveProfile })
    const remember = el('input', { type: 'checkbox', id: 'server-remember', checked: profile.rememberPassword })
    const pane = el('select', { id: 'server-pane' }, ...(['left', 'right'] as const).map(s => el('option', { value: s, textContent: t(s === 'left' ? 'server.left' : 'server.right'), selected: s === side })))
    const field = (label: Parameters<typeof t>[0], control: HTMLElement): HTMLDivElement => {
      const target = control.matches('input, select') ? control : control.querySelector('input, select')
      return el('div', { class: 'field' }, el('label', { textContent: t(label), htmlFor: target?.id || '' }), control)
    }
    const sshFields = el('div', { class: 'server-ssh' }, field('server.key', el('div', { class: 'input-action' }, key, pick)), field('server.passphrase', phrase))
    const tls = () => { sshFields.hidden = protocol.value !== 'sftp' }
    save.addEventListener('change', () => { remember.disabled = !save.checked; if (!save.checked) remember.checked = false })
    remember.disabled = !save.checked
    protocol.addEventListener('change', () => { port.value = String(portFor(protocol.value)); tls() })
    const importUrl = () => {
      if (!/^[a-z]+:\/\//i.test(host.value.trim())) return
      try {
        const u = new URL(host.value.trim())
        if (!['ftp:', 'ftps:', 'sftp:'].includes(u.protocol)) return
        protocol.value = u.protocol.slice(0, -1)
        host.value = u.hostname
        port.value = u.port || String(portFor(protocol.value))
        if (u.username) username.value = decodeURIComponent(u.username)
        if (u.password) secret.value = decodeURIComponent(u.password)
        if (u.pathname && u.pathname !== '/') dir.value = decodeURIComponent(u.pathname)
        tls()
      } catch { /* validation below keeps the dialog's input intact */ }
    }
    host.addEventListener('change', importUrl)
    saved.addEventListener('change', () => {
      profile = profiles.find(p => p.id === saved.value) || defaults()
      name.value = profile.name; protocol.value = profile.protocol; host.value = profile.host; port.value = String(profile.port)
      username.value = profile.username; dir.value = profile.remoteDir; key.value = profile.privateKeyPath
      secret.value = ''; phrase.value = ''; secret.placeholder = profile.hasPassword ? t('server.savedPassword') : ''
      remember.checked = profile.rememberPassword; tls()
    })
    tls()
    const form = el('div', { class: 'server-form' },
      field('server.saved', saved), field('server.name', name),
      el('div', { class: 'field-pair' }, field('server.protocol', protocol), field('server.port', port)),
      field('server.host', host),
      el('div', { class: 'field-pair' }, field('server.user', username), field('server.password', secret)),
      field('server.path', dir), sshFields, field('server.side', pane),
      el('label', { class: 'check' }, save, t('server.save')),
      el('label', { class: 'check' }, remember, t('server.remember'))
    )
    const pending = choose({ title: t('server.connect'), extra: form, buttons: [
      { id: 'cancel', label: t('btn.cancel') },
      { id: 'remove', label: t('server.remove') },
      { id: 'connect', label: t('server.connectNow'), kind: 'primary' }
    ], cancelId: 'cancel' })
    if (profiles.length) saved.focus()
    else host.focus()
    const result = await pending
    if (result === 'cancel') return null
    importUrl()
    profile = { id: profile.id, name: name.value, protocol: protocol.value as ServerProtocol, host: host.value, port: Number(port.value), username: username.value, remoteDir: dir.value, privateKeyPath: key.value, rememberPassword: remember.checked, hasPassword: profile.hasPassword }
    password = secret.value; passphrase = phrase.value; saveProfile = save.checked; side = pane.value as PaneSide
    if (result === 'remove') {
      if (profile.id) {
        const ok = await choose({ title: t('server.remove'), message: t('server.removeConfirm'), buttons: [{ id: 'cancel', label: t('btn.cancel') }, { id: 'remove', label: t('server.remove'), kind: 'danger' }], cancelId: 'cancel' })
        if (ok === 'remove') { await api.removeServerProfile(profile.id); profiles = await api.serverProfiles(); profile = defaults(); password = ''; passphrase = '' }
      }
      continue
    }
    const progress = busy(t('server.connecting'))
    let connected
    try { connected = await api.connectServer({ profile, password, passphrase, saveProfile }) }
    finally { progress.close() }
    if (connected.ok && connected.value) return { connection: connected.value, side }
    await alertBox(t('dlg.error.title'), connected.error || '')
  }
}
