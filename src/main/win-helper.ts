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
    if ($r.op -eq 'clipSet') {
      if (@($r.paths).Count -eq 0) { [Windows.Forms.Clipboard]::Clear() }
      else {
        $files = New-Object System.Collections.Specialized.StringCollection
        foreach ($p in @($r.paths)) { [void]$files.Add([string]$p) }
        $data = New-Object Windows.Forms.DataObject
        $data.SetFileDropList($files)
        $effect = if ($r.cut) { 2 } else { 5 }
        $data.SetData('Preferred DropEffect', (New-Object IO.MemoryStream (,[byte[]]@($effect, 0, 0, 0))))
        [Windows.Forms.Clipboard]::SetDataObject($data, $true)
      }
      $result = 'ok'
    } elseif ($r.op -eq 'clipGet') {
      $list = @()
      if ([Windows.Forms.Clipboard]::ContainsFileDropList()) { $list = @([Windows.Forms.Clipboard]::GetFileDropList()) }
      $cut = $false
      $effect = [Windows.Forms.Clipboard]::GetData('Preferred DropEffect')
      if ($effect -is [IO.MemoryStream]) { $b = $effect.ToArray(); $cut = $b.Length -gt 0 -and ($b[0] -band 2) -ne 0 }
      $result = ConvertTo-Json -Compress @{ paths = [string[]]$list; cut = $cut }
    } else {
      $result = [FdHelper]::Show([string[]]@($r.paths), [string]$r.folder, [string[]]@($r.ids), [string[]]@($r.labels), [bool]$r.extended)
    }
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
  const paths = (Array.isArray(v.paths) ? v.paths : typeof v.paths === 'string' ? [v.paths] : []).filter((p): p is string => typeof p === 'string')
  return { paths, cut: v.cut === true }
}

/** Puts files on the Windows clipboard the way Explorer does; an empty list clears it. */
export async function setWinClipboardFiles(paths: string[], cut: boolean): Promise<void> {
  await call({ op: 'clipSet', paths, cut })
}

export function stopWinHelper(): void {
  child?.kill()
  child = undefined
}
