import { app, BrowserWindow, dialog, Menu, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { translate, type MsgKey } from '@shared/i18n'
import type { ContextItem, Lang, ShellMenuResult } from '@shared/types'

// macOS: Finder-style context menu.

const run = (cmd: string, args: string[], cwd?: string, timeout?: number) => new Promise<string>((resolve, reject) => {
  execFile(cmd, args, { cwd, timeout, maxBuffer: 1 << 20 }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)))
})

const OPEN_WITH = `function run(argv) {
  ObjC.import('AppKit')
  const ws = $.NSWorkspace.sharedWorkspace, fm = $.NSFileManager.defaultManager
  const url = $.NSURL.fileURLWithPath(argv[0])
  const def = ws.URLForApplicationToOpenURL(url)
  const list = ws.URLsForApplicationsToOpenURL(url)
  const out = []
  const add = (u) => { if (u && !u.isNil()) { const p = u.path.js; if (!out.some(a => a.path === p)) out.push({ path: p, name: fm.displayNameAtPath(p).js.replace(/\\.app$/, '') }) } }
  add(def)
  for (let i = 0; i < Math.min(list.count, 30); i++) add(list.objectAtIndex(i))
  return JSON.stringify(out)
}`

interface AppInfo { path: string; name: string }

async function openWithApps(file: string): Promise<AppInfo[]> {
  try { return JSON.parse(await run('osascript', ['-l', 'JavaScript', '-e', OPEN_WITH, file])) as AppInfo[] } catch { return [] }
}

async function appIcon(p: string) {
  try { return (await app.getFileIcon(p, { size: 'small' })).resize({ width: 16, height: 16 }) } catch { return nativeImage.createEmpty() }
}

const finder = (lines: string[], args: string[]) => run('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder"', ...lines.flatMap(l => ['-e', l]), '-e', 'end tell', '-e', 'end run', ...args])

const getInfo = (paths: string[]) => finder(['activate', 'repeat with p in argv', 'open information window of (POSIX file (contents of p) as alias)', 'end repeat'], paths)
/** Finder's Delete, which works where NSFileManager trash refuses (File Provider drives such as Synology Drive). */
export const finderTrash = (p: string) => finder(['delete (POSIX file (item 1 of argv) as alias)'], [p])
const makeAlias = (paths: string[]) => finder(['repeat with p in argv', 'set f to POSIX file (contents of p) as alias', 'make new alias file at (container of f) to f', 'end repeat'], paths)

async function unique(dir: string, stem: string, ext: string): Promise<string> {
  for (let i = 1; ; i++) {
    const target = path.join(dir, `${stem}${i > 1 ? ` ${i}` : ''}${ext}`)
    if (!existsSync(target)) return target
  }
}

async function compress(paths: string[], lang: Lang): Promise<void> {
  const dir = path.dirname(paths[0])
  if (paths.length === 1) {
    const target = await unique(dir, path.basename(paths[0]), '.zip')
    await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', paths[0], target])
  } else {
    const target = await unique(dir, translate(lang, 'fx.archive'), '.zip')
    await run('zip', ['-r', '-y', '-q', target, ...paths.map(p => path.basename(p))], dir)
  }
}

const PASTEBOARD = `function run(argv) {
  ObjC.import('AppKit')
  const pb = $.NSPasteboard.generalPasteboard
  if (argv.length) {
    pb.clearContents
    pb.writeObjects($(argv.map(p => $.NSURL.fileURLWithPath(p))))
    return '[]'
  }
  const urls = pb.readObjectsForClassesOptions($([$.NSURL]), $({ NSPasteboardURLReadingFileURLsOnlyKey: true }))
  const out = []
  if (urls && !urls.isNil()) for (let i = 0; i < urls.count; i++) out.push(urls.objectAtIndex(i).path.js)
  return JSON.stringify(out)
}`

/** Puts files on the pasteboard the way Finder does (an empty list clears it). */
export async function copyFiles(paths: string[]): Promise<void> {
  await run('osascript', ['-l', 'JavaScript', '-e', PASTEBOARD, ...paths])
}

/** Files copied in Finder (or by this app), if any. */
export async function clipboardFiles(): Promise<string[]> {
  try {
    const list = JSON.parse(await run('osascript', ['-l', 'JavaScript', '-e', PASTEBOARD])) as unknown[]
    return list.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p))
  } catch { return [] }
}

export interface MacMenuRequest { paths: string[]; folder: string; extras: ContextItem[] }

/** Drive/shortcut menu: no file-only commands such as Trash, Rename or Compress. */
export async function showMacPlaceMenu(win: BrowserWindow, target: string, extras: ContextItem[], lang: Lang, onError: (message: string) => void): Promise<ShellMenuResult> {
  let ejectable = false
  if (path.dirname(target) === '/Volumes') {
    try {
      const info = await run('/usr/sbin/diskutil', ['info', '-plist', target], undefined, 1500)
      ejectable = /<key>Ejectable<\/key>\s*<true\s*\/>/.test(info)
    } catch { /* A network share or a volume that is no longer available. */ }
  }
  return new Promise(resolve => {
    let settled = false
    let acting = false
    const done = (result: ShellMenuResult) => { if (!settled) { settled = true; resolve(result) } }
    const action = (fn: () => Promise<unknown>, changed = false) => () => {
      acting = true
      void fn().then(() => done({ changed })).catch(e => {
        onError(e instanceof Error ? e.message : String(e))
        done({})
      })
    }
    const items: MenuItemConstructorOptions[] = extras.map(it => it.type === 'separator'
      ? { type: 'separator' }
      : { label: it.label, click: () => done({ id: it.id }) })
    items.push({ type: 'separator' }, { label: translate(lang, 'fx.getInfo'), click: action(() => getInfo([target])) })
    if (ejectable) items.push({ label: translate(lang, 'place.eject'), click: action(() => run('/usr/sbin/diskutil', ['eject', target]), true) })
    Menu.buildFromTemplate(items).popup({ window: win, callback: () => setTimeout(() => { if (!acting) done({}) }, 100) })
  })
}

export function showMacMenu(win: BrowserWindow, req: MacMenuRequest, lang: Lang, onError: (message: string) => void): Promise<ShellMenuResult> {
  const t = (k: MsgKey, v?: Record<string, string | number>) => translate(lang, k, v)
  return new Promise((resolve) => {
    void (async () => {
      let settled = false
      const done = (r: ShellMenuResult) => { if (!settled) { settled = true; resolve(r) } }
      const act = (fn: () => Promise<void> | void, changed = false) => () => {
        done({ changed })
        void Promise.resolve().then(fn).catch(e => onError(e instanceof Error ? e.message : String(e)))
      }
      const extras: MenuItemConstructorOptions[] = req.extras.map(it => it.type === 'separator'
        ? { type: 'separator' }
        : { label: it.label, accelerator: it.accelerator, registerAccelerator: false, click: () => done({ id: it.id }) })
      const items: MenuItemConstructorOptions[] = []
      const { paths } = req
      if (paths.length) {
        const apps = await openWithApps(paths[0])
        const icons = await Promise.all(apps.map(a => appIcon(a.path)))
        const openWith = (appPath: string) => act(() => run('open', ['-a', appPath, ...paths]).then(() => undefined))
        const other = act(async () => {
          const pick = await dialog.showOpenDialog(win, { defaultPath: '/Applications', properties: ['openFile'], filters: [{ name: 'Applications', extensions: ['app'] }] })
          if (!pick.canceled && pick.filePaths[0]) await run('open', ['-a', pick.filePaths[0], ...paths])
        })
        const name = path.basename(paths[0])
        items.push(
          { label: t('key.F3'), click: () => done({ id: 'open' }) },
          { label: t('fx.openWith'), submenu: [
            ...apps.map((a, i) => ({ label: i === 0 ? t('fx.default', { app: a.name }) : a.name, icon: icons[i], click: openWith(a.path) })),
            ...(apps.length ? [{ type: 'separator' as const }] : []),
            { label: t('fx.otherApp'), click: other }
          ] },
          { type: 'separator' },
          { label: t('menu.trash'), click: () => done({ id: 'trash' }) },
          { type: 'separator' },
          { label: t('fx.getInfo'), click: act(() => getInfo(paths).then(() => undefined)) },
          ...(paths.length === 1 ? [{ label: t('menu.rename'), click: () => done({ id: 'rename' }) }] : []),
          { label: paths.length === 1 ? t('fx.compressOne', { name }) : t('fx.compressMany', { n: paths.length }), click: act(() => compress(paths, lang), true) },
          { label: t('fx.duplicate'), accelerator: 'Cmd+D', registerAccelerator: false, click: () => done({ id: 'duplicate' }) },
          { label: t('fx.alias'), click: act(() => makeAlias(paths).then(() => undefined), true) },
          { label: paths.length === 1 ? t('fx.quickLookOne', { name }) : t('fx.quickLook'), click: act(() => win.previewFile(paths[0])) },
          { type: 'separator' },
          { label: t('fx.copy'), accelerator: 'Cmd+C', registerAccelerator: false, click: act(() => copyFiles(paths)) },
          { role: 'shareMenu', label: t('fx.share'), sharingItem: { filePaths: paths } }
        )
      } else {
        const pasted = await clipboardFiles()
        items.push(
          { label: t('fx.newFolder'), click: () => done({ id: 'mkdir' }) },
          { type: 'separator' },
          { label: t('fx.getInfo'), click: act(() => getInfo([req.folder]).then(() => undefined)) },
          { label: pasted.length > 1 ? t('fx.pasteMany', { n: pasted.length }) : t('fx.paste'), enabled: pasted.length > 0, click: () => done({ id: 'paste', paths: pasted }) }
        )
      }
      if (extras.length) items.push({ type: 'separator' }, ...extras)
      // The close callback can run before a click handler; give the click a moment to win.
      Menu.buildFromTemplate(items).popup({ window: win, callback: () => setTimeout(() => done({}), 100) })
    })().catch(e => { onError(e instanceof Error ? e.message : String(e)); resolve({}) })
  })
}
