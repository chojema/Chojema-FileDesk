import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FileDeskApi, Progress } from '@shared/types'

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
