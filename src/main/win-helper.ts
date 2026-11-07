import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import source from './win-helper.cs?raw'

// One hidden PowerShell process hosts the Explorer context menu (Windows only).
const SCRIPT = `$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'helper.cs')))
[FdHelper]::Write('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = 0
  try {
    $r = ConvertFrom-Json $line
    $id = $r.id
    $result = [FdHelper]::Show([string[]]@($r.paths), [string]$r.folder, [string[]]@($r.ids), [string[]]@($r.labels), [bool]$r.extended)
    [FdHelper]::Write((ConvertTo-Json -Compress @{ id = $id; result = $result }))
  } catch {
    [FdHelper]::Write((ConvertTo-Json -Compress @{ id = $id; error = $_.Exception.Message }))
  }
}
`

export interface WinMenuRequest { paths: string[]; folder: string; ids: string[]; labels: string[]; extended: boolean }

let child: ChildProcessWithoutNullStreams | undefined
let ready = false
let serial = 0
const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>()

export function startWinHelper(): void {
  if (process.platform !== 'win32' || child) return
  try {
    const dir = path.join(app.getPath('temp'), `filedesk-helper-${app.getVersion()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'helper.cs'), source)
    writeFileSync(path.join(dir, 'helper.ps1'), '﻿' + SCRIPT)
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Sta', '-File', path.join(dir, 'helper.ps1')], { windowsHide: true })
  } catch (e) {
    console.warn('Windows helper unavailable:', e)
    return
  }
  const proc = child
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
    child = undefined
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

export function stopWinHelper(): void {
  child?.kill()
  child = undefined
}
