import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, nativeImage, nativeTheme, screen, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import path from 'node:path'
import { existsSync, promises as fs, watch } from 'node:fs'
import { translate } from '@shared/i18n'
import type { Lang, Settings, TransferRequest } from '@shared/types'
import * as fsops from './fsops'
import { loadSettings, normalizeSettings, saveSettings } from './settings'
import { buildMenu } from './menu'
import { openTerminal } from './terminal'
import { FileService } from './file-service'
import { createConnections } from './connections'
import { checkUpdate, downloadUpdate } from './updates'
import { APP_LINKS } from '@shared/links'
import { isRemotePath } from '@shared/remote-path'
import type { ConnectRequest, ContextItem, FileClipboard, ShellMenuRequest, ShellMenuResult } from '@shared/types'
import { setWinClipboardFiles, showWinMenu, startWinHelper, stopWinHelper, winClipboardFiles, winHelperReady } from './win-helper'
import { clipboardFiles, copyFiles, showMacMenu, showMacPlaceMenu } from './mac-shell'
import { fitWindow, MIN_WINDOW, readWindowState, writeWindowState } from './window-state'
import dragIconPath from '../../resources/icon-256.png?asset'

let win: BrowserWindow | null = null
let dragIcon: NativeImage | undefined
let settings: Settings
const servers = createConnections(() => settings?.lang ?? 'ko')
const files = new FileService(fsops, servers.manager)

/** Rebuilds the app menu; the Server menu lists saved servers and marks connected ones. */
function refreshMenu(s: Settings = settings): void {
  if (!win) return
  const connected = new Set(servers.manager.connections().map(c => c.id))
  buildMenu(win, s, connected.size > 0, servers.profiles().map(p => ({ id: p.id, name: p.name, connected: connected.has(p.id) })))
}

/** Tells the renderer to reread the drive list; bursts of OS events collapse into one update. */
let placesTimer: NodeJS.Timeout | undefined
function placesChanged(): void {
  clearTimeout(placesTimer)
  placesTimer = setTimeout(() => win?.webContents.send('places:changed'), 400)
}

/**
 * Drive changes come from the OS, without polling: WM_DEVICECHANGE on Windows and the /Volumes
 * folder on macOS. Windows also rechecks when the window is activated, since mapping a network
 * drive does not always send the message.
 */
function watchDrives(w: BrowserWindow): void {
  if (process.platform === 'win32') {
    const WM_DEVICECHANGE = 0x0219, DBT_DEVICEARRIVAL = 0x8000, DBT_DEVICEREMOVECOMPLETE = 0x8004
    w.hookWindowMessage(WM_DEVICECHANGE, (wParam) => {
      const event = wParam.length >= 8 ? Number(wParam.readBigUInt64LE(0)) : wParam.readUInt32LE(0)
      if (event === DBT_DEVICEARRIVAL || event === DBT_DEVICEREMOVECOMPLETE) placesChanged()
    })
    w.on('focus', placesChanged)
  } else if (process.platform === 'darwin') {
    try {
      const watcher = watch('/Volumes', placesChanged)
      watcher.on('error', () => watcher.close())
      w.on('closed', () => watcher.close())
    } catch { /* no /Volumes */ }
  }
}

function createWindow(): void {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json')
  const state = fitWindow(settings.windowStart === 'restore' ? readWindowState(stateFile) : undefined,
    screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea)
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: Math.min(MIN_WINDOW.width, state.width),
    minHeight: Math.min(MIN_WINDOW.height, state.height),
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

  const window = win
  let timer: ReturnType<typeof setTimeout> | undefined
  let maximized = state.maximized
  const saveBounds = () => {
    clearTimeout(timer)
    if (window.isDestroyed()) return
    if (!window.isMinimized()) maximized = window.isMaximized()
    try { writeWindowState(stateFile, { ...window.getNormalBounds(), maximized }) }
    catch (e) { console.warn('Cannot save window state:', e) }
  }
  const scheduleSave = () => { clearTimeout(timer); timer = setTimeout(saveBounds, 150) }
  window.on('move', scheduleSave)
  window.on('resize', scheduleSave)
  window.on('maximize', () => { maximized = true; scheduleSave() })
  window.on('unmaximize', () => { maximized = false; scheduleSave() })
  window.on('close', saveBounds)
  window.once('closed', () => clearTimeout(timer))
  window.once('ready-to-show', () => {
    if (state.maximized) window.maximize()
    window.show()
    startWinHelper()
  })

  // Never navigate away from the app or open new windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // Text fields get the usual cut/copy/paste menu; file lists build their own.
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return
    const t = (k: Parameters<typeof translate>[1]) => translate(settings.lang, k)
    Menu.buildFromTemplate([
      { role: 'cut', label: t('ctx.cut'), enabled: params.editFlags.canCut },
      { role: 'copy', label: t('ctx.copy'), enabled: params.editFlags.canCopy },
      { role: 'paste', label: t('ctx.paste'), enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: t('ctx.selectAll') }
    ]).popup({ window })
  })

  refreshMenu()

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  watchDrives(win)
  win.on('closed', () => (win = null))
}

function registerIpc(): void {
  const progress = (p: unknown) => win?.webContents.send('progress', p)

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:save', async (_e, value: Settings) => {
    const s = normalizeSettings(value)
    settings = s
    nativeTheme.themeSource = s.theme
    refreshMenu(s)
    await saveSettings(s)
  })
  ipcMain.handle('menu:lang', (_e, lang: Lang) => {
    if (lang !== 'ko' && lang !== 'en') return
    settings = { ...settings, lang }
    refreshMenu()
  })
  ipcMain.handle('fs:list', (_e, p: string) => files.list(p))
  ipcMain.handle('fs:places', async () => [
    ...await fsops.places({
      home: translate(settings.lang, 'places.home'),
      desktop: translate(settings.lang, process.platform === 'win32' ? 'places.desktopWindows' : 'places.desktop'),
      documents: translate(settings.lang, 'places.documents'),
      downloads: translate(settings.lang, 'places.downloads')
    }),
    ...servers.manager.connections().map(s => ({ id: `server-${s.id}`, label: s.name, path: s.root, kind: 'server' as const }))
  ])
  ipcMain.handle('fs:space', (_e, p: string) => isRemotePath(p) ? null : fsops.diskSpace(p))
  ipcMain.handle('fs:resolve', (_e, input: string, base: string) => files.resolve(input, base))
  ipcMain.handle('fs:conflicts', (_e, sources: string[], dest: string) => files.conflicts(sources, dest))
  ipcMain.handle('fs:transfer', (_e, req: TransferRequest) => files.transfer({ ...req, lang: settings.lang }, progress))
  ipcMain.handle('clip:read', async (): Promise<FileClipboard> => {
    try {
      if (process.platform === 'darwin') return { paths: await clipboardFiles(), cut: false }
      if (process.platform === 'win32' && winHelperReady()) return await winClipboardFiles()
    } catch { /* fall back to the app's own clipboard */ }
    return { paths: [], cut: false }
  })
  ipcMain.handle('clip:write', async (_e, paths: string[], cut: boolean) => {
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string' || isRemotePath(p))) return
    try {
      if (process.platform === 'darwin') await copyFiles(paths)
      else if (process.platform === 'win32' && winHelperReady()) await setWinClipboardFiles(paths, !!cut)
    } catch { /* the app keeps its own clipboard */ }
  })
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
  ipcMain.handle('server:remove', async (_e, id: string) => { await servers.remove(id); refreshMenu() })
  ipcMain.handle('server:connect', async (_e, req: ConnectRequest) => {
    try {
      const value = await servers.connect(req)
      refreshMenu()
      return { ok: true, value }
    }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
  ipcMain.handle('server:disconnect', async (_e, root: string) => {
    await servers.manager.disconnect(root)
    refreshMenu()
  })
  // System file-type icons. Server files use a local placeholder with the same extension.
  ipcMain.handle('fs:icon', async (_e, p: unknown) => {
    if (typeof p !== 'string') return ''
    try {
      let target = p
      if (isRemotePath(p)) {
        const ext = path.extname(decodeURIComponent(new URL(p).pathname)).slice(1)
        const dir = path.join(app.getPath('temp'), 'filedesk-icons')
        target = path.join(dir, /^[a-z0-9_-]{1,16}$/i.test(ext) ? `file.${ext.toLowerCase()}` : 'file')
        if (!existsSync(target)) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(target, '') }
      } else if (!path.isAbsolute(p)) return ''
      const image = await app.getFileIcon(target, { size: 'normal' })
      return image.isEmpty() ? '' : image.toDataURL()
    } catch { return '' }
  })
  ipcMain.handle('menu:context', async (e, req: ShellMenuRequest) => {
    const owner = BrowserWindow.fromWebContents(e.sender)
    if (!owner || !req || typeof req.folder !== 'string' || !Array.isArray(req.paths) || !Array.isArray(req.items) || !Array.isArray(req.extras) ||
      req.paths.length > 5000 || req.items.length > 40 || req.extras.length > 40) return {}
    const local = !isRemotePath(req.folder) && path.isAbsolute(req.folder) &&
      req.paths.every((p) => typeof p === 'string' && !isRemotePath(p) && path.isAbsolute(p))
    if (local && process.platform === 'darwin') {
      if (req.place && req.paths.length === 1) {
        return showMacPlaceMenu(owner, req.paths[0], req.extras, settings.lang, (message) => owner.webContents.send('app:error', message))
      }
      return showMacMenu(owner, req, settings.lang, (message) => owner.webContents.send('app:error', message))
    }
    if (local && process.platform === 'win32' && winHelperReady()) {
      try {
        const handle = owner.getNativeWindowHandle()
        const sep = (it: ContextItem) => it?.type === 'separator'
        const result = await showWinMenu({
          paths: req.paths,
          folder: req.folder,
          ids: req.extras.map((it) => (sep(it) ? '-' : String(it.id))),
          labels: req.extras.map((it) => (sep(it) ? '' : `${String(it.label)}${it.accelerator ? `\t${it.accelerator.replace('CmdOrCtrl', 'Ctrl')}` : ''}`)),
          extended: !!req.extended,
          // A decimal string keeps the native pointer exact across JSON on 32/64-bit hosts.
          owner: (handle.length >= 8 ? handle.readBigInt64LE(0) : BigInt(handle.readInt32LE(0))).toString()
        })
        if (result.startsWith('app:')) return { id: result.slice(4) }
        return result === 'shell' ? { changed: true } : {}
      } catch (err) {
        console.warn('Explorer menu failed, using the app menu:', err)
      }
    }
    return appMenu(owner, req.items)
  })
  // Drag local files out of the window into Finder/Explorer or another app.
  ipcMain.on('drag:start', (e, paths: unknown) => {
    if (!Array.isArray(paths) || !paths.length || paths.length > 10000) return
    const items = paths.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p) && !isRemotePath(p) && existsSync(p))
    if (items.length !== paths.length) return
    dragIcon ??= nativeImage.createFromPath(dragIconPath).resize({ width: 48, height: 48 })
    e.sender.startDrag({ file: items[0], files: items, icon: dragIcon })
  })
  ipcMain.handle('server:connections', () => servers.manager.connections())
  ipcMain.handle('server:key', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], title: settings.lang === 'ko' ? 'SSH 개인 키 선택' : 'Select SSH private key' })
    return result.canceled ? null : result.filePaths[0]
  })
}

function appMenu(owner: BrowserWindow, items: ContextItem[]): Promise<ShellMenuResult> {
  return new Promise((resolve) => {
    const template: MenuItemConstructorOptions[] = items.map((it) => it?.type === 'separator'
      ? { type: 'separator' }
      : {
          label: String(it?.label ?? '').slice(0, 200),
          accelerator: typeof it?.accelerator === 'string' ? it.accelerator : undefined,
          registerAccelerator: false,
          enabled: it?.enabled !== false,
          click: () => resolve({ id: String(it?.id ?? '') })
        })
    // On some platforms the close callback runs before the click handler.
    Menu.buildFromTemplate(template).popup({ window: owner, callback: () => setTimeout(() => resolve({}), 100) })
  })
}

app.on('before-quit', () => {
  void servers.manager.closeAll()
  stopWinHelper()
})

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
