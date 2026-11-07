import { app, BrowserWindow, clipboard, ipcMain, shell, nativeTheme } from 'electron'
import path from 'node:path'
import { translate } from '@shared/i18n'
import type { Lang, Settings, TransferRequest } from '@shared/types'
import * as fsops from './fsops'
import { loadSettings, saveSettings } from './settings'
import { buildMenu } from './menu'
import { openTerminal } from './terminal'

let win: BrowserWindow | null = null
let settings: Settings

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
  ipcMain.handle('fs:list', (_e, p: string) => fsops.listDir(p))
  ipcMain.handle('fs:places', () =>
    fsops.places({
      home: translate(settings.lang, 'places.home'),
      desktop: translate(settings.lang, 'places.desktop'),
      documents: translate(settings.lang, 'places.documents'),
      downloads: translate(settings.lang, 'places.downloads')
    })
  )
  ipcMain.handle('fs:space', (_e, p: string) => fsops.diskSpace(p))
  ipcMain.handle('fs:resolve', (_e, input: string, base: string) => fsops.resolveInput(input, base))
  ipcMain.handle('fs:conflicts', (_e, sources: string[], dest: string) => fsops.findConflicts(sources, dest))
  ipcMain.handle('fs:transfer', (_e, req: TransferRequest) => fsops.transfer(req, progress))
  ipcMain.handle('fs:mkdir', (_e, parent: string, name: string) => fsops.mkdir(parent, name))
  ipcMain.handle('fs:rename', (_e, p: string, name: string) => fsops.rename(p, name))
  ipcMain.handle('fs:trash', (_e, paths: string[]) => fsops.trash(paths, progress))
  ipcMain.handle('fs:dirSize', (_e, p: string) => fsops.dirSize(p))
  ipcMain.handle('shell:open', async (_e, p: string) => {
    const err = await shell.openPath(p)
    return err ? { ok: false, error: err } : { ok: true }
  })
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:terminal', (_e, p: string) => openTerminal(p))
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
}

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
