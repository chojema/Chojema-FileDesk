import { app } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import source from './win-helper.cs?raw'

// One hidden helper process hosts the Explorer context menu (Windows only). It is compiled from
// win-helper.cs instead of run by PowerShell, which forces English shell menus on Korean Windows.
export interface WinMenuRequest { paths: string[]; folder: string; ids: string[]; labels: string[]; extended: boolean; owner: string }

let child: ChildProcessWithoutNullStreams | undefined
let starting = false
let stopped = false
let ready = false
let serial = 0
const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>()

/** Compiles the helper once per source revision with the csc.exe that ships with Windows. */
async function helperExe(): Promise<string> {
  const dir = path.join(app.getPath('temp'), `filedesk-helper-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`)
  const exe = path.join(dir, 'FileDeskHelper.exe')
  if (existsSync(exe)) return exe
  const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET')
  const csc = ['Framework64', 'Framework'].map((d) => path.join(framework, d, 'v4.0.30319', 'csc.exe')).find((p) => existsSync(p))
  if (!csc) throw new Error('csc.exe not found')
  mkdirSync(dir, { recursive: true })
  const cs = path.join(dir, 'helper.cs')
  writeFileSync(cs, source)
  // Build under a temporary name so an interrupted compile never leaves a broken helper behind.
  const tmp = path.join(dir, `build-${process.pid}.exe`)
  await promisify(execFile)(csc, ['/nologo', '/target:winexe', '/optimize+', `/out:${tmp}`, '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll', cs], { windowsHide: true })
  renameSync(tmp, exe)
  return exe
}

export function startWinHelper(): void {
  if (process.platform !== 'win32' || child || starting) return
  starting = true
  helperExe()
    .then((exe) => { if (!stopped) attach(spawn(exe, [], { windowsHide: true })) })
    .catch((e) => console.warn('Windows helper unavailable:', e))
    .finally(() => { starting = false })
}

function attach(proc: ChildProcessWithoutNullStreams): void {
  child = proc
  proc.stdin.setDefaultEncoding('utf8')
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg: { ready?: boolean; id?: number; result?: string; error?: string }
    try { msg = JSON.parse(line.replace(/^﻿/, '')) } catch { return }
    if (msg.ready) ready = true
    if (typeof msg.id === 'number') {
      const request = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) request?.reject(new Error(msg.error))
      else request?.resolve(String(msg.result ?? 'none'))
    }
  })
  proc.stderr.on('data', (d) => console.warn('Windows helper:', String(d).trim()))
  const fail = () => {
    ready = false
    if (child === proc) child = undefined
    for (const request of pending.values()) request.reject(new Error('Windows helper stopped'))
    pending.clear()
  }
  proc.on('exit', fail)
  proc.on('error', fail)
}

export const winHelperReady = (): boolean => ready && !!child

/** Shows the Explorer menu; resolves "app:<id>", "shell" or "none". */
export function showWinMenu(request: WinMenuRequest): Promise<string> {
  if (!child || !ready) return Promise.reject(new Error('Windows helper not ready'))
  const id = ++serial
  const proc = child
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    proc.stdin.write(JSON.stringify({ id, ...request }) + '\n')
  })
}

function call(request: Record<string, unknown>): Promise<string> {
  if (!child || !ready) return Promise.reject(new Error('Windows helper not ready'))
  const id = ++serial
  const proc = child
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    proc.stdin.write(JSON.stringify({ id, ...request }) + '\n')
  })
}

/** Files on the Windows clipboard (CF_HDROP) and whether Explorer marked them as cut. */
export async function winClipboardFiles(): Promise<{ paths: string[]; cut: boolean }> {
  const v = JSON.parse(await call({ op: 'clipGet' })) as { paths?: unknown; cut?: unknown }
  const paths = (Array.isArray(v.paths) ? v.paths : []).filter((p): p is string => typeof p === 'string')
  return { paths, cut: v.cut === true }
}

/** Puts files on the Windows clipboard the way Explorer does; an empty list clears it. */
export async function setWinClipboardFiles(paths: string[], cut: boolean): Promise<void> {
  await call({ op: 'clipSet', paths, cut })
}

export function stopWinHelper(): void {
  stopped = true
  child?.kill()
  child = undefined
}
