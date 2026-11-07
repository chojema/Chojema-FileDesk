import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, nativeTheme } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { translate } from '@shared/i18n'
import type { Lang, Settings, TransferRequest } from '@shared/types'
import * as fsops from './fsops'
import { loadSettings, saveSettings } from './settings'
import { buildMenu } from './menu'
import { openTerminal } from './terminal'
import { FileService } from './file-service'
import { createConnections } from './connections'
import { checkUpdate, downloadUpdate } from './updates'
import { APP_LINKS } from '@shared/links'
import { isRemotePath } from '@shared/remote-path'
import type { ConnectRequest } from '@shared/types'

let win: BrowserWindow | null = null
let settings: Settings
const servers = createConnections(() => settings?.lang ?? 'ko')
const files = new FileService(fsops, servers.manager)

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Chojema FileDesk',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
    // Packaged builds take the icon from the executable; dev runs on Windows/Linux use the source PNG.
    ...(app.isPackaged || process.platform === 'darwin' ? {} : { icon: path.join(__dirname, '../../build/icon-win.png') }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win?.show())

  // Never navigate away from the app or open new windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  buildMenu(win, settings)

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => (win = null))
}

function registerIpc(): void {
  const progress = (p: unknown) => win?.webContents.send('progress', p)

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:save', async (_e, s: Settings) => {
    settings = s
    nativeTheme.themeSource = s.theme
    if (win) buildMenu(win, s) // keep menu language and checkbox states in sync
    await saveSettings(s)
  })
  ipcMain.handle('menu:lang', (_e, lang: Lang) => {
    if (win) buildMenu(win, { ...settings, lang })
  })
  ipcMain.handle('fs:list', (_e, p: string) => files.list(p))
  ipcMain.handle('fs:places', async () => [
    ...await fsops.places({
      home: translate(settings.lang, 'places.home'),
      desktop: translate(settings.lang, 'places.desktop'),
      documents: translate(settings.lang, 'places.documents'),
      downloads: translate(settings.lang, 'places.downloads')
    }),
    ...servers.manager.connections().map(s => ({ id: `server-${s.id}`, label: s.name, path: s.root, kind: 'server' as const }))
  ])
  ipcMain.handle('fs:space', (_e, p: string) => isRemotePath(p) ? null : fsops.diskSpace(p))
  ipcMain.handle('fs:resolve', (_e, input: string, base: string) => files.resolve(input, base))
  ipcMain.handle('fs:conflicts', (_e, sources: string[], dest: string) => files.conflicts(sources, dest))
  ipcMain.handle('fs:transfer', (_e, req: TransferRequest) => files.transfer(req, progress))
  ipcMain.handle('fs:mkdir', (_e, parent: string, name: string) => files.mkdir(parent, name))
  ipcMain.handle('fs:rename', (_e, p: string, name: string) => files.rename(p, name))
  ipcMain.handle('fs:trash', (_e, paths: string[]) => files.trash(paths, progress))
  ipcMain.handle('fs:dirSize', (_e, p: string) => files.dirSize(p))
  ipcMain.handle('shell:open', async (_e, p: string) => {
    if (isRemotePath(p)) {
      try {
        const item = await files.stat(p)
        if (!item || item.isDir || item.isSymlink) return { ok: false, error: 'Select a remote file to download and open.' }
        const work = await fs.mkdtemp(path.join(app.getPath('temp'), 'filedesk-open-'))
        const local = path.join(work, item.name)
        await servers.manager.download(p, local, () => {})
        const error = await shell.openPath(local)
        return error ? { ok: false, error } : { ok: true }
      } catch (e) { return { ok: false, error: String(e) } }
    }
    const err = await shell.openPath(p)
    return err ? { ok: false, error: err } : { ok: true }
  })
  ipcMain.handle('shell:reveal', (_e, p: string) => { if (!isRemotePath(p)) shell.showItemInFolder(p) })
  ipcMain.handle('shell:terminal', (_e, p: string) => isRemotePath(p) ? { ok: false, error: 'Terminal is available for local folders only.' } : openTerminal(p))
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('link:open', async (_e, url: string) => {
    if (!APP_LINKS.some(link => link.url === url) && !/^https:\/\/github\.com\/chojema\/Chojema-FileDesk\/releases(?:\/tag\/v?\d+\.\d+\.\d+)?$/.test(url)) throw new Error('Unknown application link')
    await shell.openExternal(url)
  })
  ipcMain.handle('update:check', async () => {
    try { return { ok: true, value: await checkUpdate() } }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
  ipcMain.handle('update:download', async () => {
    try { return { ok: true, value: await downloadUpdate(p => win?.webContents.send('update:progress', p)) } }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
  ipcMain.handle('server:profiles', () => servers.profiles())
  ipcMain.handle('server:remove', (_e, id: string) => servers.remove(id))
  ipcMain.handle('server:connect', async (_e, req: ConnectRequest) => {
    try { return { ok: true, value: await servers.connect(req) } }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
  ipcMain.handle('server:disconnect', (_e, root: string) => servers.manager.disconnect(root))
  ipcMain.handle('server:connections', () => servers.manager.connections())
  ipcMain.handle('server:key', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], title: settings.lang === 'ko' ? 'SSH 개인 키 선택' : 'Select SSH private key' })
    return result.canceled ? null : result.filePaths[0]
  })
}

app.on('before-quit', () => { void servers.manager.closeAll() })

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.chojema.filedesk')
    settings = loadSettings()
    nativeTheme.themeSource = settings.theme
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
