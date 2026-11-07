import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { FileDeskApi, Progress, UpdateProgress } from '@shared/types'

const api: FileDeskApi = {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:version'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  listDir: (p) => ipcRenderer.invoke('fs:list', p),
  places: () => ipcRenderer.invoke('fs:places'),
  diskSpace: (p) => ipcRenderer.invoke('fs:space', p),
  resolvePath: (input, base) => ipcRenderer.invoke('fs:resolve', input, base),
  findConflicts: (sources, dest) => ipcRenderer.invoke('fs:conflicts', sources, dest),
  transfer: (req) => ipcRenderer.invoke('fs:transfer', req),
  mkdir: (parent, name) => ipcRenderer.invoke('fs:mkdir', parent, name),
  rename: (p, name) => ipcRenderer.invoke('fs:rename', p, name),
  trash: (paths) => ipcRenderer.invoke('fs:trash', paths),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  revealInOs: (p) => ipcRenderer.invoke('shell:reveal', p),
  openTerminal: (p) => ipcRenderer.invoke('shell:terminal', p),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  dirSize: (p) => ipcRenderer.invoke('fs:dirSize', p),
  setMenuLang: (lang) => ipcRenderer.invoke('menu:lang', lang),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  serverProfiles: () => ipcRenderer.invoke('server:profiles'),
  removeServerProfile: (id) => ipcRenderer.invoke('server:remove', id),
  connectServer: (req) => ipcRenderer.invoke('server:connect', req),
  disconnectServer: (root) => ipcRenderer.invoke('server:disconnect', root),
  serverConnections: () => ipcRenderer.invoke('server:connections'),
  pickPrivateKey: () => ipcRenderer.invoke('server:key'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  startDrag: (paths) => ipcRenderer.send('drag:start', paths),
  contextMenu: (req) => ipcRenderer.invoke('menu:context', req),
  onAppError: (cb) => {
    const h = (_e: IpcRendererEvent, message: string) => cb(message)
    ipcRenderer.on('app:error', h)
    return () => ipcRenderer.removeListener('app:error', h)
  },
  fileIcon: (p) => ipcRenderer.invoke('fs:icon', p),
  onUpdateProgress: (cb) => {
    const handler = (_e: IpcRendererEvent, p: UpdateProgress) => cb(p)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },
  onProgress: (cb) => {
    const h = (_e: IpcRendererEvent, p: Progress) => cb(p)
    ipcRenderer.on('progress', h)
    return () => ipcRenderer.removeListener('progress', h)
  },
  onMenu: (cb) => {
    const h = (_e: IpcRendererEvent, c: string) => cb(c)
    ipcRenderer.on('menu', h)
    return () => ipcRenderer.removeListener('menu', h)
  }
}

contextBridge.exposeInMainWorld('filedesk', api)
