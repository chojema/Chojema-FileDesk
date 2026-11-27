import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

const nativeWindows = process.platform === 'win32'
const refs = ['System.Windows.Forms.dll', 'System.Web.Extensions.dll']

/** Starts the compiled production helper, or `script` hosting FdHelper.Run in PowerShell. */
async function startHelper(script?: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filedesk-win-helper-'))
  const cs = path.join(dir, 'helper.cs')
  await fs.copyFile(new URL('../src/main/win-helper.cs', import.meta.url), cs)
  let child
  if (script) {
    await fs.writeFile(path.join(dir, 'helper.ps1'), '\uFEFF' + script)
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Sta', '-File', path.join(dir, 'helper.ps1')], { windowsHide: true })
  } else {
    // Same compiler and options as src/main/win-helper.ts.
    const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET')
    const csc = ['Framework64', 'Framework'].map(d => path.join(framework, d, 'v4.0.30319', 'csc.exe')).find(p => existsSync(p))
    assert.ok(csc, 'csc.exe not found')
    const exe = path.join(dir, 'FileDeskHelper.exe')
    execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', `/out:${exe}`, ...refs.map(r => `/r:${r}`), cs], { windowsHide: true })
    child = spawn(exe, [], { windowsHide: true })
  }
  const lines = createInterface({ input: child.stdout })
  const messages: Record<string, unknown>[] = []
  const waiters: { match: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void; reject: (e: Error) => void }[] = []
  let stderr = ''
  child.stderr.on('data', d => { stderr += String(d) })
  lines.on('line', line => {
    let message: Record<string, unknown>
    try { message = JSON.parse(line.replace(/^\uFEFF/, '')) } catch { return }
    const index = waiters.findIndex(w => w.match(message))
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message)
    else messages.push(message)
  })
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => {
      for (const w of waiters.splice(0)) w.reject(new Error(`Helper exited ${code}: ${stderr}`))
      resolve(code)
    })
  })
  const next = (match: (m: Record<string, unknown>) => boolean) => {
    const index = messages.findIndex(match)
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0])
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error(`Timed out waiting for helper: ${stderr}`))
      }, 10000)
      const waiter = { match, resolve: (m: Record<string, unknown>) => { clearTimeout(timer); resolve(m) }, reject: (e: Error) => { clearTimeout(timer); reject(e) } }
      waiters.push(waiter)
    })
  }
  const stop = async () => {
    child.stdin.end()
    const timer = setTimeout(() => child.kill(), 3000)
    try { assert.equal(await closed, 0, stderr) }
    finally { clearTimeout(timer); lines.close(); await fs.rm(dir, { recursive: true, force: true }) }
  }
  return { child, next, stop }
}

test('Windows helper pumps idle UI callbacks and queues requests across nested message loops', { skip: !nativeWindows, timeout: 20000 }, async () => {
  const helper = await startHelper(`$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Web.Extensions -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'helper.cs')))
$script:uiThread = [Threading.Thread]::CurrentThread.ManagedThreadId
[FdHelper]::Run([Action[string]] {
  param([string]$line)
  if ([Threading.Thread]::CurrentThread.ManagedThreadId -ne $script:uiThread) { throw 'Dispatch left the UI thread' }
  if ($line -eq 'idle') {
    $script:timer = New-Object Windows.Forms.Timer
    $script:timer.Interval = 75
    $script:timer.add_Tick({ $script:timer.Stop(); [FdHelper]::Write('{"event":"idle-tick"}') })
    $script:timer.Start()
    [FdHelper]::Write('{"event":"scheduled"}')
  } elseif ($line -eq 'modal') {
    [FdHelper]::Write('{"event":"modal-open"}')
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt 300) { [Windows.Forms.Application]::DoEvents(); [Threading.Thread]::Sleep(5) }
    [FdHelper]::Write('{"event":"modal-close"}')
  } else { [FdHelper]::Write('{"event":"queued-request"}') }
})`)
  try {
    await helper.next(m => m.ready === true)
    helper.child.stdin.write('idle\n')
    await helper.next(m => m.event === 'scheduled')
    // No second stdin request: this callback must run while the reader is blocked.
    await helper.next(m => m.event === 'idle-tick')
    helper.child.stdin.write('modal\n')
    await helper.next(m => m.event === 'modal-open')
    helper.child.stdin.write('next\n')
    const first = await helper.next(m => m.event === 'modal-close' || m.event === 'queued-request')
    assert.equal(first.event, 'modal-close', 'Request must not reenter a modal shell command')
    await helper.next(m => m.event === 'queued-request')
  } finally { await helper.stop() }
})

test('Windows production helper preserves request IDs, survives bad JSON and ignores a closed owner during warm-up', { skip: !nativeWindows, timeout: 20000 }, async () => {
  const helper = await startHelper()
  try {
    await helper.next(m => m.ready === true)
    helper.child.stdin.write('{invalid-json\n')
    assert.equal(typeof (await helper.next(m => m.id === 0)).error, 'string')
    // An invalid owner must neither show a popup nor borrow another application's window.
    const request = { paths: ['C:\\'], folder: 'C:\\', ids: [], labels: [], extended: false, owner: '0' }
    helper.child.stdin.write(JSON.stringify({ id: 41, ...request }) + '\n')
    helper.child.stdin.write(JSON.stringify({ id: 42, ...request }) + '\n')
    assert.equal((await helper.next(m => m.id === 41)).result, 'none')
    assert.equal((await helper.next(m => m.id === 42)).result, 'none')
  } finally { await helper.stop() }
})
