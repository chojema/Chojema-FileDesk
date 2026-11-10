import './styles.css'
import { LANGS, type MsgKey } from '@shared/i18n'
import type { ColumnWidths, ConflictPolicy, ContextItem, FileClipboard, FileEntry, Lang, PaneSide, Place, ServerConnection, Settings, ShellMenuRequest, ShellMenuResult, ThemePref, TransferResult } from '@shared/types'
import { alertBox, busy, choose, isModalOpen, popup, prompt } from './dialogs'
import { Pane, type PaneHost } from './pane'
import { api, el, icon, isMac, setLang, t, type IconName } from './util'
import { formatSize } from './util'
import { APP_LINKS } from '@shared/links'
import { isRemotePath, remotePath } from '@shared/remote-path'
import { connectDialog, connectSaved } from './server-ui'
import { showUpdate } from './update-ui'
import { PLACE_SHORTCUTS, placeTarget, visiblePlaces } from '@shared/places'

let settings: Settings
let active: Pane
let operating = false
let booting = true
const panes = {} as Record<PaneSide, Pane>
const lastLocal = { left: '', right: '' }

const other = (p: Pane): Pane => (p === panes.left ? panes.right : panes.left)

// Keep changes pending while a click, rename, menu or file operation owns the list.
const changedDirectories = new Map<Pane, string>()
let refreshTimer = 0
let pointerDown = false
let dragging = false
let menuOpen = false
let interactionUntil = 0
const canAutoRefresh = () => !booting && !operating && !isModalOpen() && !menuOpen && !pointerDown && !dragging && Date.now() >= interactionUntil

function scheduleAutoRefresh(): void {
  if (!refreshTimer && changedDirectories.size) refreshTimer = window.setTimeout(flushAutoRefresh, 250)
}

function flushAutoRefresh(): void {
  refreshTimer = 0
  for (const [pane, dir] of [...changedDirectories]) {
    if (pane.path !== dir) { changedDirectories.delete(pane); continue }
    if (!pane.canAutoRefresh()) continue
    changedDirectories.delete(pane)
    void pane.refresh(true).catch(() => false).then(ok => {
      // An interaction may have begun while the directory was being read.
      if (!ok && pane.path === dir && !pane.canAutoRefresh()) changedDirectories.set(pane, dir)
      scheduleAutoRefresh()
    })
  }
  scheduleAutoRefresh()
}

for (const type of ['mousedown', 'mouseup', 'keydown', 'wheel', 'dragstart', 'dragover', 'drop', 'dragend', 'blur'] as const) {
  window.addEventListener(type, e => {
    if (type === 'blur' && e.target !== window) return
    interactionUntil = Date.now() + 700
    if (type === 'mousedown') pointerDown = true
    if (type === 'mouseup' || type === 'blur') pointerDown = false
    if (type === 'dragstart' || type === 'dragover') dragging = true
    if (type === 'drop' || type === 'dragend' || type === 'blur') dragging = false
  }, true)
}
window.addEventListener('dragleave', e => { if (!e.relatedTarget) dragging = false }, true)
window.addEventListener('mousemove', e => { if (!e.buttons) { pointerDown = false; dragging = false } }, true)

// ---------- theme ----------

const media = window.matchMedia('(prefers-color-scheme: dark)')
function applyTheme(): void {
  const pref: ThemePref = settings.theme
  const dark = pref === 'dark' || (pref === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}
media.addEventListener('change', applyTheme)

// ---------- settings persistence ----------

let saveTimer = 0
function persist(): void {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    for (const side of ['left', 'right'] as PaneSide[]) {
      const p = panes[side]
      if (!isRemotePath(p.path)) lastLocal[side] = p.path
      settings.panes[side] = { path: lastLocal[side] || p.path, sortKey: p.sortKey, sortAsc: p.sortAsc }
    }
    void api.saveSettings(settings)
  }, 400)
}

// ---------- pane host ----------

const host: PaneHost = {
  activate(p) {
    if (active === p) return
    active = p
    panes.left.setActive(p === panes.left)
    panes.right.setActive(p === panes.right)
    updateToolbarDirection()
  },
  isActive: (p) => active === p,
  placeTarget: (pane, place) => placeTarget(place, other(pane).path, places, api.platform === 'win32'),
  isVisible: (e) => (settings.showHidden || !e.hidden) && (settings.showDotFiles || !e.dot),
  hiddenShown: () => settings.showHidden && settings.showDotFiles,
  toggleHiddenAll: () => void run('toggleHiddenAll'),
  onOpenFile: (entry) => void openFile(entry),
  onError: (msg) => void alertBox(t('dlg.error.title'), msg),
  onStateChange: () => { persist(); updateToolbarDirection() },
  canAutoRefresh,
  onVisited: addRecent,
  isFavorite: (p) => settings.favorites.some((f) => pathKey(f) === pathKey(p)),
  // The pane activates itself before calling these, so the commands act on it.
  openHistory: () => void run('history'),
  openFavorites: () => void run('favorites'),
  disconnect: pane => { if (!operating && !isModalOpen()) void disconnectServer(pane).catch(e => alertBox(t('dlg.error.title'), String(e))) },
  startDrag(pane, items, e) {
    const paths = items.map((i) => i.path)
    if (!paths.length || !e.dataTransfer) { e.preventDefault(); return }
    if (isRemotePath(pane.path)) {
      // Server items can only be dropped on the other pane.
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths))
      e.dataTransfer.effectAllowed = 'copyMove'
      return
    }
    e.preventDefault()
    api.startDrag(paths)
  },
  renameEntry: (pane, entry, name) => renameEntry(pane, entry, name),
  contextMenu: (pane, onRow, extended) => void showContextMenu(pane, onRow, extended),
  placeContextMenu: (pane, place, extended) => void guarded(() => showPlaceContextMenu(pane, place, extended)),
  columnWidth: (key) => settings.columns[key],
  resizeColumn(key, width, done) {
    // Both panes share the widths; keep at least 80px for names in the narrower pane.
    const others = (Object.keys(settings.columns) as (keyof ColumnWidths)[]).filter((k) => k !== key).reduce((n, k) => n + settings.columns[k], 0)
    const room = Math.min(panes.left.columnsWidth(), panes.right.columnsWidth()) - 32 - 3 * 8 - others - 80
    settings.columns[key] = Math.round(Math.max(36, Math.min(600, room, width)))
    applyColumns()
    if (done) persist()
  }
}

function applyColumns(): void {
  const style = document.documentElement.style
  style.setProperty('--col-ext', `${settings.columns.ext}px`)
  style.setProperty('--col-size', `${settings.columns.size}px`)
  style.setProperty('--col-date', `${settings.columns.mtime}px`)
}

// ---------- context menu ----------

async function showShellMenu(req: ShellMenuRequest): Promise<ShellMenuResult> {
  menuOpen = true
  try { return await api.contextMenu(req) }
  finally { menuOpen = false; pointerDown = false; interactionUntil = Date.now() + 700 }
}

async function showPlaceContextMenu(pane: Pane, place: Place, extended: boolean): Promise<void> {
  if (operating || isModalOpen()) return
  const remote = isRemotePath(place.path)
  const items: ContextItem[] = [
    { id: 'placeOpen', label: t('place.open') },
    { id: 'placeOther', label: t('place.openOther') },
    { type: 'separator' },
    { id: 'placeCopyPath', label: t('place.copyPath') },
    ...(!remote ? [
      { id: 'placeReveal', label: t('ctx.openFolder') },
      { id: 'placeTerminal', label: t('tb.terminal') }
    ] : [])
  ]
  const result = await showShellMenu({ paths: [place.path], folder: place.path, items, extras: items, place: true, extended })
  if (result.id === 'placeOpen') await pane.load(place.path)
  else if (result.id === 'placeOther') {
    const target = other(pane)
    if (await target.load(place.path)) host.activate(target)
  } else if (result.id === 'placeCopyPath') await api.writeClipboard(place.path)
  else if (result.id === 'placeReveal') {
    const opened = await api.openPath(place.path)
    if (!opened.ok) throw new Error(opened.error)
  } else if (result.id === 'placeTerminal') {
    const opened = await api.openTerminal(place.path)
    if (!opened.ok) throw new Error(opened.error)
  }
  if (result.changed) window.setTimeout(() => void loadPlaces(), 600)
}

async function showContextMenu(pane: Pane, onRow: boolean, extended: boolean): Promise<void> {
  if (operating || isModalOpen()) return
  host.activate(pane)
  const remote = isRemotePath(pane.path)
  const sep: ContextItem = { type: 'separator' }
  const item = (id: string, label: MsgKey, accelerator?: string): ContextItem => ({ id, label: t(label), accelerator })
  // Full app menu (server folders) and the app commands added to the Explorer/Finder menu.
  const items: ContextItem[] = onRow
    ? [
        item('open', 'key.F3', 'Enter'),
        sep,
        item('copy', 'menu.copy', 'F5'),
        item('move', 'menu.move', 'F6'),
        item('rename', 'menu.rename', 'F2'),
        item('trash', remote ? 'server.remoteDeleteTitle' : 'menu.trash', 'F8'),
        sep,
        item('copyFiles', 'ctx.copy', 'CmdOrCtrl+C'),
        item('duplicate', 'fx.duplicate', 'CmdOrCtrl+D'),
        item('copyPath', 'tb.copyPath', 'CmdOrCtrl+Shift+C'),
        sep,
        item('mkdir', 'menu.newFolder', 'F7'),
        item('refresh', 'menu.refresh', 'CmdOrCtrl+R')
      ]
    : [
        item('mkdir', 'menu.newFolder', 'F7'),
        item('refresh', 'menu.refresh', 'CmdOrCtrl+R'),
        sep,
        item('paste', 'ctx.paste', 'CmdOrCtrl+V'),
        item('copyFolderPath', 'ctx.copyFolderPath'),
        item('copyList', 'tb.copyList'),
        sep,
        item('sameDir', 'menu.sameDir', 'CmdOrCtrl+='),
        item('swap', 'menu.swap', 'CmdOrCtrl+U')
      ]
  const extras: ContextItem[] = onRow
    ? [
        item('copy', 'menu.copy', 'F5'),
        item('move', 'menu.move', 'F6'),
        ...(api.platform === 'win32' ? [item('rename', 'menu.rename', 'F2'), item('duplicate', 'fx.duplicate', 'Ctrl+D')] : []),
        item('copyPath', 'tb.copyPath', 'CmdOrCtrl+Shift+C'),
        item('reveal', 'menu.reveal'),
        item('refresh', 'menu.refresh', 'CmdOrCtrl+R')
      ]
    : [
        item('refresh', 'menu.refresh', 'CmdOrCtrl+R'),
        item('copyFolderPath', 'ctx.copyFolderPath'),
        item('copyList', 'tb.copyList'),
        item('terminal', 'tb.terminal'),
        sep,
        item('sameDir', 'menu.sameDir', 'CmdOrCtrl+='),
        item('swap', 'menu.swap', 'CmdOrCtrl+U')
      ]
  const paths = onRow ? pane.targets().map((e) => e.path) : []
  const result = await showShellMenu({ paths, folder: pane.path, items, extras, extended })
  if (result.changed) {
    // Explorer/Finder commands may finish a moment later.
    window.setTimeout(() => { void panes.left.refresh(); void panes.right.refresh() }, 600)
  }
  if (result.id === 'paste' && result.paths?.length) {
    await guarded(async () => { await executeTransfer('copy', result.paths!, pane.path) })
  } else if (result.id) await run(result.id)
}

async function guarded(fn: () => Promise<void>): Promise<void> {
  if (operating || isModalOpen()) return
  try { await fn() }
  catch (e) { await alertBox(t('dlg.error.title'), e instanceof Error ? e.message : String(e)) }
  if (!isModalOpen()) active.focus()
}

// ---------- drag and drop ----------

const DRAG_TYPE = 'application/x-filedesk-paths'

/** Folder comparison key without trailing separators. */
function dirKey(p: string): string {
  const k = p.replace(/[\\/]+$/, '')
  return isRemotePath(p) || api.platform === 'linux' ? k : k.toLowerCase()
}

function baseName(p: string): string {
  const s = isRemotePath(p) ? remotePath(p).path : p
  return s.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s
}

function parentDir(p: string): string {
  const s = p.replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(0, i) : s
}

function wireDrop(pane: Pane, root: HTMLElement): void {
  const accepts = (e: DragEvent) => !!e.dataTransfer && (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DRAG_TYPE))
  const moveKey = (e: DragEvent) => (isMac ? e.metaKey : e.shiftKey)
  root.addEventListener('dragover', (e) => {
    if (!accepts(e) || operating || isModalOpen()) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = moveKey(e) ? 'move' : 'copy'
    pane.markDrop(e)
  })
  root.addEventListener('dragleave', (e) => {
    if (!(e.relatedTarget instanceof Node) || !root.contains(e.relatedTarget)) pane.markDrop(null)
  })
  root.addEventListener('drop', (e) => {
    pane.markDrop(null)
    if (!accepts(e) || operating || isModalOpen()) return
    e.preventDefault()
    const dt = e.dataTransfer!
    let sources: string[] = []
    const internal = dt.getData(DRAG_TYPE)
    if (internal) {
      try { sources = (JSON.parse(internal) as unknown[]).filter((p): p is string => typeof p === 'string') } catch { sources = [] }
    } else {
      sources = [...dt.files].map((f) => api.pathForFile(f)).filter(Boolean)
    }
    const destDir = pane.dropDir(e)
    // Dropping items back into the folder they came from does nothing.
    sources = sources.filter((s) => dirKey(parentDir(s)) !== dirKey(destDir) && dirKey(s) !== dirKey(destDir))
    if (!sources.length) return
    host.activate(pane)
    void guarded(async () => { await executeTransfer(moveKey(e) ? 'move' : 'copy', sources, destDir) })
  })
}

// ---------- visited folders & favorites ----------

const MAX_RECENT = 30

/** Comparison key: case-insensitive on Windows/macOS, no trailing separator (except roots). */
function pathKey(p: string): string {
  if (isRemotePath(p)) return p.replace(/\/$/, '')
  let k = p.length > 3 ? p.replace(/[\\/]+$/, '') : p
  if (api.platform !== 'linux') k = k.toLowerCase()
  return k
}

function folderLabel(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || p
}

function addRecent(p: string): void {
  const key = pathKey(p)
  settings.recentDirs = [p, ...settings.recentDirs.filter((x) => pathKey(x) !== key)].slice(0, MAX_RECENT)
  persist()
}

function refreshPaneTools(): void {
  panes.left.refreshTools()
  panes.right.refreshTools()
}

function openHistory(pane: Pane): void {
  popup(pane.historyBtn, t('tb.history'), () => {
    const list = settings.recentDirs.filter((d) => pathKey(d) !== pathKey(pane.path))
    if (!list.length) return [{ label: t('hist.empty'), disabled: true }]
    return [
      ...list.map((d) => ({
        label: folderLabel(d),
        detail: d,
        icon: 'folder2' as const,
        onSelect: () => void pane.load(d).then(() => pane.focus()),
        onRemove: () => {
          settings.recentDirs = settings.recentDirs.filter((x) => pathKey(x) !== pathKey(d))
          persist()
        }
      })),
      {
        label: t('hist.clear'),
        icon: 'trashSmall' as const,
        action: true,
        separatorBefore: true,
        onSelect: () => {
          // Keep only the folders the two panes are showing right now.
          settings.recentDirs = settings.recentDirs.filter((x) => [panes.left.path, panes.right.path].some((p) => pathKey(p) === pathKey(x)))
          persist()
        }
      }
    ]
  })
}

function openFavorites(pane: Pane): void {
  popup(pane.favBtn, t('tb.favorites'), () => {
    const isFav = host.isFavorite(pane.path)
    const toggle = {
      label: t(isFav ? 'fav.remove' : 'fav.add'),
      detail: pane.path,
      icon: (isFav ? 'minus' : 'plus') as 'minus' | 'plus',
      action: true,
      onSelect: () => {
        if (isFav) settings.favorites = settings.favorites.filter((f) => pathKey(f) !== pathKey(pane.path))
        else settings.favorites = [...settings.favorites, pane.path]
        refreshPaneTools()
        persist()
      }
    }
    const favs = settings.favorites.map((f, i) => ({
      label: folderLabel(f),
      detail: f,
      icon: 'starFill' as const,
      separatorBefore: i === 0,
      onSelect: () => void pane.load(f).then(() => pane.focus()),
      onRemove: () => {
        settings.favorites = settings.favorites.filter((x) => pathKey(x) !== pathKey(f))
        refreshPaneTools()
        persist()
      }
    }))
    return [toggle, ...(favs.length ? favs : [{ label: t('fav.empty'), disabled: true, separatorBefore: true }])]
  })
}

async function openFile(entry: FileEntry): Promise<void> {
  const res = await api.openPath(entry.path)
  if (!res.ok) await alertBox(t('dlg.error.title'), entry.name, res.error)
}

// ---------- operations ----------

async function reportErrors(r: TransferResult): Promise<void> {
  if (!r.errors.length) return
  const detail = r.errors
    .map((e) => `${e.path}\n  → ${e.message === 'into-self' ? t('err.intoSelf') : e.message}`)
    .join('\n')
  await alertBox(t('dlg.error.title'), t('dlg.result.errors', { n: r.errors.length }), detail)
}

async function runWithProgress<T>(titleKey: MsgKey, fn: () => Promise<T>): Promise<T> {
  operating = true
  const b = busy(t(titleKey))
  const off = api.onProgress((p) => b.update(p.bytes === undefined ? p.current : `${p.current} · ${formatSize(p.bytes)}`, p.total ? p.index / p.total : 0))
  try {
    return await fn()
  } finally {
    off()
    b.close()
    operating = false
  }
}

async function transfer(op: 'copy' | 'move'): Promise<void> {
  const src = active
  const dst = other(active)
  const items = src.targets()
  if (!items.length) return
  if (src.path === dst.path) {
    await alertBox(t(op === 'copy' ? 'dlg.copy.title' : 'dlg.move.title'), t('err.sameDir'))
    return
  }
  const destInput = await prompt({
    title: t(op === 'copy' ? 'dlg.copy.title' : 'dlg.move.title'),
    message: t('dlg.transfer.msg', { n: items.length, op: t(op === 'copy' ? 'key.F5' : 'key.F6') }),
    label: items.length === 1 ? items[0].name : t('status.items', { n: items.length }),
    value: dst.path
  })
  if (destInput === null) return
  const resolved = await api.resolvePath(destInput, dst.path)
  if (!resolved.ok || !resolved.value) {
    await alertBox(t('dlg.error.title'), `${t('err.notFound')}\n${destInput}`)
    return
  }
  await executeTransfer(op, items.map((i) => i.path), resolved.value)
}

/** Copies or moves sources into destDir after asking about name conflicts, then refreshes both panes. */
async function executeTransfer(op: 'copy' | 'move', sources: string[], destDir: string): Promise<TransferResult | undefined> {
  let policy: ConflictPolicy = 'skip'
  const conflicts = await api.findConflicts(sources, destDir)
  if (conflicts.length) {
    const choice = await choose<'overwrite' | 'skip' | 'cancel'>({
      title: t('dlg.conflict.title'),
      message: t('dlg.conflict.msg', { n: conflicts.length }),
      detail: conflicts.slice(0, 50).join('\n') + (conflicts.length > 50 ? '\n…' : ''),
      buttons: [
        { id: 'cancel', label: t('btn.cancel') },
        { id: 'skip', label: t('btn.skip') },
        { id: 'overwrite', label: t('btn.overwrite'), kind: 'primary' }
      ],
      cancelId: 'cancel'
    })
    if (choice === 'cancel') return
    policy = choice
  }
  const result = await runWithProgress(op === 'copy' ? 'busy.copy' : 'busy.move', () =>
    api.transfer({ op, sources, destDir, policy })
  )
  await Promise.all([panes.left.refresh(), panes.right.refresh()])
  // Put the cursor on a copy made in place, as Explorer and Finder select it.
  const made = result.created?.[0]
  if (made && dirKey(destDir) === dirKey(active.path)) await active.load(active.path, { push: false, focusName: baseName(made) })
  await reportErrors(result)
  return result
}

// ---------- file clipboard (Ctrl+C/X/V, Cmd+C/V, Cmd+Option+V) ----------

// Server files cannot go on the OS clipboard, so the app also keeps its own copy.
let fileClip: FileClipboard | null = null
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((p, i) => dirKey(p).normalize('NFC') === dirKey(b[i]).normalize('NFC'))

async function clipFiles(cut: boolean): Promise<void> {
  const paths = active.targets().map(e => e.path)
  if (!paths.length) return
  fileClip = { paths, cut }
  // Server files clear the OS clipboard so a later paste does not pick up older files.
  await api.writeFileClipboard(paths.some(isRemotePath) ? [] : paths, cut)
  toast(t(cut ? 'toast.filesCut' : 'toast.filesCopied', { n: paths.length }))
}

async function pasteFiles(forceMove = false): Promise<void> {
  const os = await api.readFileClipboard()
  let clip: FileClipboard | null = null
  if (os.paths.length && !(fileClip && sameList(os.paths, fileClip.paths))) clip = os
  else if (fileClip) clip = fileClip
  if (!clip) return
  const move = clip.cut || forceMove
  const result = await executeTransfer(move ? 'move' : 'copy', clip.paths, active.path)
  // A cut is pasted once, as in Explorer.
  if (move && result) { fileClip = null; if (os.paths.length) await api.writeFileClipboard([], false) }
}

/** Copies the selection in place right away (Ctrl+D / Cmd+D). */
async function duplicateFiles(): Promise<void> {
  const paths = active.targets().map(e => e.path)
  if (paths.length) await executeTransfer('copy', paths, active.path)
}

async function makeDir(): Promise<void> {
  const name = await prompt({ title: t('dlg.mkdir.title'), label: t('dlg.mkdir.msg'), value: active.targets()[0]?.name })
  if (!name) return
  const res = await api.mkdir(active.path, name)
  if (!res.ok) {
    await alertBox(t('dlg.error.title'), res.error === 'invalid-name' ? t('err.invalidName') : (res.error ?? ''))
    return
  }
  await active.load(active.path, { push: false, focusName: name.trim() })
  if (other(active).path === active.path) await other(active).refresh()
}

async function renameEntry(pane: Pane, entry: FileEntry, name: string): Promise<void> {
  const res = await api.rename(entry.path, name)
  if (!res.ok) {
    const msg = res.error === 'invalid-name' ? t('err.invalidName') : res.error === 'EEXIST' ? t('dlg.conflict.title') : (res.error ?? '')
    await alertBox(t('dlg.error.title'), msg)
    return
  }
  await pane.load(pane.path, { push: false, focusName: name })
  if (other(pane).path === pane.path) await other(pane).refresh()
}

async function trashTargets(): Promise<void> {
  const items = active.targets()
  if (!items.length) return
  const remoteDelete = items.some(i => isRemotePath(i.path))
  if (settings.confirmDelete || remoteDelete) {
    const ok = await choose<'ok' | 'cancel'>({
      title: t(remoteDelete ? 'server.remoteDeleteTitle' : 'dlg.delete.title'),
      message: t(remoteDelete ? 'server.remoteDelete' : 'dlg.delete.msg', { n: items.length }),
      detail: items.slice(0, 30).map((i) => i.name).join('\n') + (items.length > 30 ? '\n…' : ''),
      buttons: [
        { id: 'cancel', label: t('btn.cancel') },
        { id: 'ok', label: t('key.F8'), kind: 'danger' }
      ],
      cancelId: 'cancel'
    })
    if (ok !== 'ok') return
  }
  const result = await runWithProgress('busy.trash', () => api.trash(items.map((i) => i.path)))
  await Promise.all([active.refresh(), other(active).refresh()])
  await reportErrors(result)
}

function swapPanes(): void {
  const l = panes.left.path
  const r = panes.right.path
  void panes.left.load(r)
  void panes.right.load(l)
}

function applyHidden(): void {
  panes.left.rerender()
  panes.right.rerender()
  persist()
}

function toggleHidden(): void {
  settings.showHidden = !settings.showHidden
  applyHidden()
}

function toggleDot(): void {
  settings.showDotFiles = !settings.showDotFiles
  applyHidden()
}

/** If anything is hidden, show everything; otherwise hide both kinds. */
function toggleHiddenAll(): void {
  const showAll = !(settings.showHidden && settings.showDotFiles)
  settings.showHidden = showAll
  settings.showDotFiles = showAll
  applyHidden()
}

async function openSettings(): Promise<void> {
  const langSel = el('select')
  for (const l of LANGS) langSel.append(el('option', { value: l.id, textContent: l.label, selected: l.id === settings.lang }))
  const themeSel = el('select')
  for (const id of ['system', 'light', 'dark'] as ThemePref[]) {
    themeSel.append(el('option', { value: id, textContent: t(`set.theme.${id}` as MsgKey), selected: id === settings.theme }))
  }
  const windowStart = el('select', { id: 'set-window-start' },
    el('option', { value: 'restore', textContent: t('set.window.restore'), selected: settings.windowStart !== 'reset' }),
    el('option', { value: 'reset', textContent: t('set.window.reset'), selected: settings.windowStart === 'reset' }))
  const hidden = el('input', { type: 'checkbox', checked: settings.showHidden, id: 'set-hidden' })
  const dot = el('input', { type: 'checkbox', checked: settings.showDotFiles, id: 'set-dot' })
  const confirmDel = el('input', { type: 'checkbox', checked: settings.confirmDelete, id: 'set-confirm' })
  const autoUpdate = el('input', { type: 'checkbox', checked: settings.checkUpdatesOnStart, id: 'set-updates' })
  const fkeys = el('input', { type: 'checkbox', checked: settings.showFkeys, id: 'set-fkeys' })
  const shortcuts = PLACE_SHORTCUTS.map(id => ({ id, input: el('input', { type: 'checkbox', checked: settings.visiblePlaces[id], id: `set-place-${id}` }) }))
  const form = el(
    'div',
    {},
    el('div', { class: 'field' }, el('label', { textContent: t('set.lang') }), langSel),
    el('div', { class: 'field' }, el('label', { textContent: t('set.theme') }), themeSel),
    el('div', { class: 'field' }, el('label', { textContent: t('set.window') , htmlFor: 'set-window-start' }), windowStart),
    el('div', { class: 'group-label', textContent: t('set.hiddenGroup') }),
    el('label', { class: 'check' }, hidden, t('set.hidden')),
    el('label', { class: 'check' }, dot, t('set.dot')),
    el('div', { class: 'group-sep' }),
    el('div', { class: 'group-label', textContent: t('set.places') }),
    ...shortcuts.map(({ id, input }) => el('label', { class: 'check' }, input, t(id === 'desktop' && api.platform === 'win32' ? 'places.desktopWindows' : `places.${id}`))),
    el('div', { class: 'group-sep' }),
    el('label', { class: 'check' }, fkeys, t('set.fkeys')),
    el('label', { class: 'check' }, confirmDel, t('set.confirmDelete')),
    el('label', { class: 'check' }, autoUpdate, t('update.onStart'))
  )
  const res = await choose<'ok' | 'cancel'>({
    title: t('dlg.settings.title'),
    extra: form,
    buttons: [
      { id: 'cancel', label: t('btn.cancel') },
      { id: 'ok', label: t('btn.ok'), kind: 'primary' }
    ],
    cancelId: 'cancel'
  })
  if (res !== 'ok') return
  const langChanged = settings.lang !== langSel.value
  settings.lang = langSel.value as Lang
  settings.theme = themeSel.value as ThemePref
  settings.windowStart = windowStart.value as Settings['windowStart']
  settings.showHidden = hidden.checked
  settings.showDotFiles = dot.checked
  settings.confirmDelete = confirmDel.checked
  settings.checkUpdatesOnStart = autoUpdate.checked
  settings.showFkeys = fkeys.checked
  for (const { id, input } of shortcuts) settings.visiblePlaces[id] = input.checked
  applyPlaces()
  applyTheme()
  applyFkeys()
  if (langChanged) {
    setLang(settings.lang)
    await api.setMenuLang(settings.lang)
    renderFkeys()
    renderToolbar()
    await loadPlaces()
  }
  panes.left.rerender()
  panes.right.rerender()
  persist()
}

async function showAbout(): Promise<void> {
  const version = await api.getVersion()
  const links = el('div', { class: 'about-links' })
  for (const link of APP_LINKS) {
    const button = el('button', { class: 'about-link', type: 'button', textContent: link.label, title: link.url })
    button.addEventListener('click', () => { void api.openLink(link.url) })
    links.append(button)
  }
  await choose({ title: t('dlg.about.title'), message: t('dlg.about.body', { version }), extra: links,
    buttons: [{ id: 'close', label: t('btn.close'), kind: 'primary' }], cancelId: 'close' })
}

async function connectServer(): Promise<void> {
  await showConnection(await connectDialog({ side: active.side }))
}

/** Opens a saved server from the Server menu in the active pane. */
async function connectSavedServer(id: string): Promise<void> {
  await showConnection(await connectSaved(id, active.side))
}

async function showConnection(result: { connection: ServerConnection; side: PaneSide } | null): Promise<void> {
  if (!result) return
  const pane = panes[result.side]
  if (!isRemotePath(pane.path)) lastLocal[result.side] = pane.path
  await loadPlaces()
  await pane.load(result.connection.root)
  host.activate(pane)
  pane.focus()
}

async function disconnectServer(pane = active): Promise<void> {
  let root = isRemotePath(pane.path) ? pane.path : Object.values(panes).find(p => isRemotePath(p.path))?.path
  if (!root) {
    const connections = await api.serverConnections()
    if (!connections.length) return
    const list = el('select', {}, ...connections.map(c => el('option', { value: c.root, textContent: c.name })))
    const result = await choose({ title: t('server.disconnect'), extra: list, buttons: [
      { id: 'cancel', label: t('btn.cancel') }, { id: 'disconnect', label: t('server.disconnect'), kind: 'primary' }
    ], cancelId: 'cancel' })
    if (result !== 'disconnect') return
    root = list.value
  }
  const key = remotePath(root).key
  await api.disconnectServer(root)
  const fallback = (await api.places())[0]?.path || '/'
  for (const side of ['left', 'right'] as const) {
    if (isRemotePath(panes[side].path) && remotePath(panes[side].path).key === key) await panes[side].load(lastLocal[side] || fallback)
  }
  await loadPlaces()
}

async function showShortcuts(): Promise<void> {
  const body = el('div', { class: 'kbd-list', textContent: t('shortcuts.body', { mod: isMac ? '⌘' : 'Ctrl' }) })
  await choose({ title: t('menu.shortcuts'), extra: body, buttons: [{ id: 'ok', label: t('btn.close'), kind: 'primary' }], cancelId: 'ok' })
}

const commands: Record<string, () => void | Promise<void>> = {
  open: () => {
    const e = active.currentEntry()
    if (e) return e.isDir ? void active.load(e.path) : openFile(e)
  },
  parent: () => active.goParent(),
  top: () => active.goTop(),
  bottom: () => active.goBottom(),
  copy: () => transfer('copy'),
  move: () => transfer('move'),
  mkdir: makeDir,
  rename: () => active.beginRename(),
  trash: trashTargets,
  refresh: () => {
    void panes.left.refresh()
    void panes.right.refresh()
  },
  toggleHidden,
  toggleDot,
  toggleHiddenAll,
  swap: swapPanes,
  sameDir: () => void other(active).load(active.path),
  reveal: () => {
    const e = active.currentEntry()
    void api.revealInOs(e ? e.path : active.path)
  },
  openFolder: async () => {
    const res = await api.openPath(active.path)
    if (!res.ok) await alertBox(t('dlg.error.title'), active.path, res.error)
  },
  copyFolderPath: async () => {
    await api.writeClipboard(active.path)
    toast(t('toast.pathCopied', { path: active.path }))
  },
  settings: openSettings,
  about: showAbout,
  connect: connectServer,
  disconnect: () => disconnectServer(),
  checkUpdate: () => showUpdate(),
  shortcuts: showShortcuts,
  focusPath: () => active.focusPath(),
  terminal: async () => {
    const res = await api.openTerminal(active.path)
    if (!res.ok) await alertBox(t('dlg.error.title'), t('err.terminal'), `${active.path}\n${res.error ?? ''}`)
  },
  copyPath: copyPaths,
  copyFiles: () => clipFiles(false),
  cutFiles: () => clipFiles(true),
  paste: () => pasteFiles(),
  pasteMove: () => pasteFiles(true),
  duplicate: duplicateFiles,
  copyList: copyList,
  history: () => openHistory(active),
  favorites: () => openFavorites(active)
}

const EOL = api.platform === 'win32' ? '\r\n' : '\n'

/** Copies the names of everything listed in the active pane (display order, hidden filters applied). */
async function copyList(): Promise<void> {
  const names = active.visibleEntries().map((e) => e.name)
  if (!names.length) {
    toast(t('toast.listEmpty'))
    return
  }
  await api.writeClipboard(names.join(EOL))
  toast(t('toast.listCopied', { n: names.length }))
}

/** Copies the selected items' paths (one per line), the item under the cursor, or the current folder. */
async function copyPaths(): Promise<void> {
  const items = active.targets()
  // Cursor on ".." (or an empty folder): copy the current folder itself.
  const paths = items.length ? items.map((e) => e.path) : [active.path]
  await api.writeClipboard(paths.join(EOL))
  toast(paths.length === 1 ? t('toast.pathCopied', { path: paths[0] }) : t('toast.pathsCopied', { n: paths.length }))
}

let toastTimer = 0
function toast(message: string): void {
  document.querySelector('.toast')?.remove()
  const node = el('div', { class: 'toast', role: 'status', textContent: message })
  document.body.append(node)
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => node.remove(), 2200)
}

async function run(cmd: string): Promise<void> {
  if (operating || isModalOpen()) return
  if (cmd === 'rename' && active.isEditing()) return
  // A command issued while a name is being edited applies the edit first.
  for (const p of [panes.left, panes.right]) await p.finishRename(true)
  try { await (cmd.startsWith('server:') ? connectSavedServer(cmd.slice(7)) : commands[cmd]?.()) }
  catch (e) { await alertBox(t('dlg.error.title'), e instanceof Error ? e.message : String(e)) }
  if (!isModalOpen() && !active.isEditing()) active.focus()
}

// ---------- function key bar ----------

function applyFkeys(): void {
  document.getElementById('fkeys')!.hidden = !settings.showFkeys
}

function renderFkeys(): void {
  const keys: [string, MsgKey, string, boolean?][] = [
    ['F2', 'key.F2', 'rename'],
    ['F3', 'key.F3', 'open'],
    ['F5', 'key.F5', 'copy'],
    ['F6', 'key.F6', 'move'],
    ['F7', 'key.F7', 'mkdir'],
    ['F8', 'key.F8', 'trash', true],
    ['F10', 'key.F10', 'settings']
  ]
  const bar = document.getElementById('fkeys')!
  bar.replaceChildren(
    ...keys.map(([k, label, cmd, danger]) => {
      const b = el('button', { class: `fkey ${danger ? 'danger' : ''}`, type: 'button', tabIndex: -1 }, el('kbd', { textContent: k }), el('span', { textContent: t(label) }))
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => void run(cmd))
      return b
    })
  )
}

// ---------- keyboard ----------

function onKey(e: KeyboardEvent): void {
  if (isModalOpen() || operating) return
  if ((e.target as HTMLElement).tagName === 'INPUT') return
  const mod = isMac ? e.metaKey : e.ctrlKey
  const k = e.key
  let cmd: string | null = null
  if (k === 'Tab' && !mod) {
    host.activate(other(active))
    active.focus()
    e.preventDefault()
    return
  }
  if (k === 'F2') cmd = 'rename'
  else if (k === 'F3') cmd = 'open'
  else if (k === 'F5') cmd = 'copy'
  else if (k === 'F6' && !e.shiftKey) cmd = 'move'
  else if (k === 'F6' && e.shiftKey) cmd = 'rename'
  else if (k === 'F7') cmd = 'mkdir'
  else if (k === 'F8' || k === 'Delete' || (isMac && e.metaKey && k === 'Backspace')) cmd = 'trash'
  else if (k === 'F10' || (mod && k === ',')) cmd = 'settings'
  else if (mod && k.toLowerCase() === 'r') cmd = 'refresh'
  else if (mod && (k === '.' || k === '>')) cmd = 'toggleHiddenAll'
  else if (mod && k.toLowerCase() === 'u') cmd = 'swap'
  else if (mod && (k === '=' || k === '+')) cmd = 'sameDir'
  else if (mod && k.toLowerCase() === 'l') cmd = 'focusPath'
  else if (mod && e.shiftKey && e.code === 'KeyC') cmd = 'copyPath'
  // Physical keys, so the shortcuts also work with a Korean input source.
  else if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyC') cmd = 'copyFiles'
  else if (!isMac && mod && !e.shiftKey && !e.altKey && e.code === 'KeyX') cmd = 'cutFiles'
  else if (mod && !e.shiftKey && e.code === 'KeyV') cmd = isMac && e.altKey ? 'pasteMove' : 'paste'
  else if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyD') cmd = 'duplicate'
  else if (mod && e.shiftKey && e.code === 'KeyD') cmd = 'favorites'
  else if (e.altKey && !mod && k === 'ArrowDown') cmd = 'history'
  else if (mod && !e.shiftKey && k.toLowerCase() === 'k') cmd = 'connect'
  else if (isMac && e.metaKey && e.shiftKey && k.toLowerCase() === 'n') cmd = 'mkdir'
  if (cmd) {
    e.preventDefault()
    void run(cmd)
    return
  }
  if (active.handleKey(e)) e.preventDefault()
}

// ---------- vertical toolbar between the panes (also the resize handle) ----------

const TOOLBAR_W = 48

function renderToolbar(): void {
  const bar = document.getElementById('toolbar')!
  bar.setAttribute('aria-label', t('tb.label'))
  const parentKey = isMac ? '⌘↑' : 'Backspace'
  const items: ([IconName, MsgKey, string, string, string?] | null)[] = [
    ['tbParent', 'tb.parent', 'parent', parentKey],
    ['tbTop', 'tb.top', 'top', 'Home'],
    null,
    ['tbMkdir', 'menu.newFolder', 'mkdir', 'F7'],
    ['tbCopy', 'menu.copy', 'copy', 'F5', 'accent dir'],
    ['tbMove', 'menu.move', 'move', 'F6', 'accent dir'],
    ['tbTrash', 'menu.trash', 'trash', 'F8', 'danger'],
    null,
    ['tbBottom', 'tb.bottom', 'bottom', 'End']
  ]
  // Pinned to the bottom edge of the toolbar.
  const terminal: [IconName, MsgKey, string] = ['tbTerminal', 'tb.terminal', 'terminal']
  const copyPath: [IconName, MsgKey, string, string] = ['tbCopyPath', 'tb.copyPath', 'copyPath', isMac ? '⌘⇧C' : 'Ctrl+Shift+C']
  const copyList: [IconName, MsgKey, string] = ['tbCopyList', 'tb.copyList', 'copyList']

  const button = (ic: IconName, label: MsgKey, cmd: string, key?: string, cls?: string): HTMLButtonElement => {
    const text = key ? `${t(label)} (${key})` : t(label)
    const b = el('button', { class: `tb-btn ${cls ?? ''}`, type: 'button', tabIndex: -1, title: text }, icon(ic, ''))
    b.dataset.command = cmd
    b.setAttribute('aria-label', text)
    // Keep keyboard focus in the active pane.
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    b.addEventListener('click', () => void run(cmd))
    return b
  }

  const main = el('div', { class: 'tb-main' })
  const head = el('div', { class: 'tb-head' }, button('tbSwap', 'menu.swap', 'swap', isMac ? '⌘U' : 'Ctrl+U'))
  main.append(...items.map((it) => (it ? button(...it) : el('div', { class: 'tb-sep' }))))
  const foot = el('div', { class: 'tb-foot' }, el('div', { class: 'tb-sep' }), button(...terminal), button(...copyPath), button(...copyList))
  bar.replaceChildren(head, main, foot)
  updateToolbarDirection()
}

/** Copy/move arrows point from the active pane toward the other pane. */
function updateToolbarDirection(): void {
  document.getElementById('toolbar')!.classList.toggle('to-left', active === panes.right)
  const trash = document.querySelector<HTMLButtonElement>('#toolbar .danger')
  if (trash) {
    const label = `${t(isRemotePath(active.path) ? 'server.remoteDeleteTitle' : 'menu.trash')} (F8)`
    trash.title = label
    trash.setAttribute('aria-label', label)
  }
}

function initResize(): void {
  const bar = document.getElementById('toolbar')!
  const container = document.getElementById('panes')!
  bar.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const rect = container.getBoundingClientRect()
    const move = (ev: MouseEvent) => {
      const ratio = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width))
      container.style.gridTemplateColumns = `${ratio}fr ${TOOLBAR_W}px ${1 - ratio}fr`
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })
  bar.addEventListener('dblclick', (e) => {
    if (!(e.target as HTMLElement).closest('.tb-btn')) container.style.gridTemplateColumns = ''
  })
}

let places: Place[] = []
let placesRequest = 0
function applyPlaces(): void {
  const shown = visiblePlaces(places, settings.visiblePlaces)
  panes.left.setPlaces(shown)
  panes.right.setPlaces(shown)
}

async function loadPlaces(): Promise<void> {
  const request = ++placesRequest
  const list = await api.places()
  if (request !== placesRequest) return // a newer reload is under way
  const before = places
  places = list
  applyPlaces()
  // A pane showing a drive that was just removed moves to the first place (home).
  const gone = before.filter(p => (p.kind === 'drive' || p.kind === 'volume') && !list.some(q => q.id === p.id))
  for (const pane of [panes.left, panes.right]) {
    const key = dirKey(pane.path)
    const under = (root: string) => { const r = dirKey(root); return key === r || key.startsWith(`${r}/`) || key.startsWith(`${r}\\`) }
    if (!isRemotePath(pane.path) && gone.some(p => under(p.path))) await pane.load(list[0]?.path || '/')
  }
}

// ---------- boot ----------

async function boot(): Promise<void> {
  settings = await api.getSettings()
  setLang(settings.lang)
  applyTheme()
  renderFkeys()
  applyFkeys()
  applyColumns()
  api.onAppError((message) => void alertBox(t('dlg.error.title'), message))
  initResize()

  for (const side of ['left', 'right'] as PaneSide[]) {
    const root = document.querySelector<HTMLElement>(`.pane[data-side="${side}"]`)!
    const p = new Pane(root, side, host, settings.panes[side].path)
    p.sortKey = settings.panes[side].sortKey
    p.sortAsc = settings.panes[side].sortAsc
    lastLocal[side] = isRemotePath(settings.panes[side].path) ? '' : settings.panes[side].path
    panes[side] = p
    wireDrop(p, root)
  }
  active = panes.left
  panes.left.setActive(true)
  renderToolbar()
  window.addEventListener('keydown', onKey)
  api.onMenu((cmd) => void run(cmd))
  api.onPlacesChanged(() => void loadPlaces())
  api.onDirectoryChanged((side, dir) => {
    const pane = panes[side]
    if (pane?.path !== dir) return
    changedDirectories.set(pane, dir)
    scheduleAutoRefresh()
  })
  if (settings.checkUpdatesOnStart) window.setTimeout(() => {
    if (!operating && !isModalOpen()) void showUpdate(true).catch(() => {})
  }, 1500)
  // Pick up external changes when the window regains focus.
  window.addEventListener('focus', () => {
    pointerDown = false
    dragging = false
    if (booting) return
    for (const pane of [panes.left, panes.right]) changedDirectories.set(pane, pane.path)
    scheduleAutoRefresh()
  })

  // Drive discovery and each pane load independently. A slow/unavailable drive must not
  // delay local folders, the other pane, or command registration.
  const fallback = loadPlaces().catch(e => host.onError(String(e))).then(() =>
    places.find(p => p.id === 'home')?.path ?? places[0]?.path ?? '/')
  await Promise.all((['left', 'right'] as PaneSide[]).map(side =>
    panes[side].loadInitial(settings.panes[side].path, fallback)))
  booting = false
  if (document.activeElement === document.body) active.focus()
}

void boot()
