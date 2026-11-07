import { spawn, type SpawnOptions } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import type { Result } from '@shared/types'

/** Starts a detached process; resolves false if the executable could not be launched. */
function launch(file: string, args: string[], opts: SpawnOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', ...opts })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

/** Opens the platform's terminal with `dir` as the working directory. */
export async function openTerminal(dir: string): Promise<Result<void>> {
  try {
    if (!(await fsp.stat(dir)).isDirectory()) return { ok: false, error: 'not-a-directory' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  let ok = false
  if (process.platform === 'win32') {
    // Windows Terminal when installed; otherwise a classic console. The folder is passed as cwd,
    // so cmd never has to parse the path (spaces, &, % are safe).
    ok = (await launch('wt.exe', ['-d', '.'], { cwd: dir })) || (await launch('cmd.exe', ['/c', 'start', 'cmd.exe'], { cwd: dir }))
  } else if (process.platform === 'darwin') {
    ok = await launch('/usr/bin/open', ['-a', 'Terminal', dir])
  } else {
    for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']) {
      if ((ok = await launch(term, [], { cwd: dir }))) break
    }
  }
  return ok ? { ok: true } : { ok: false, error: 'terminal-not-found' }
}
