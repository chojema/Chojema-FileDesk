import './styles.css'
import { LANGS, type MsgKey } from '@shared/i18n'
import type { ConflictPolicy, FileEntry, Lang, PaneSide, Settings, ThemePref, TransferResult } from '@shared/types'
import { alertBox, busy, choose, isModalOpen, popup, prompt } from './dialogs'
import { Pane, type PaneHost } from './pane'
import { api, el, icon, isMac, setLang, t, type IconName } from './util'

let settings: Settings
let active: Pane
let operating = false
const panes = {} as Record<PaneSide, Pane>

const other = (p: Pane): Pane => (p === panes.left ? panes.right : panes.left)

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
      settings.panes[side] = { path: p.path, sortKey: p.sortKey, sortAsc: p.sortAsc }
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
  isVisible: (e) => (settings.showHidden || !e.hidden) && (settings.showDotFiles || !e.dot),
  hiddenShown: () => settings.showHidden && settings.showDotFiles,
  toggleHiddenAll: () => void run('toggleHiddenAll'),
  onOpenFile: (entry) => void openFile(entry),
  onError: (msg) => void alertBox(t('dlg.error.title'), msg),
  onStateChange: persist,
  onVisited: addRecent,
  isFavorite: (p) => settings.favorites.some((f) => pathKey(f) === pathKey(p)),
  // The pane activates itself before calling these, so the commands act on it.
  openHistory: () => void run('history'),
  openFavorites: () => void run('favorites')
}

// ---------- visited folders & favorites ----------

const MAX_RECENT = 30

/** Comparison key: case-insensitive on Windows/macOS, no trailing separator (except roots). */
function pathKey(p: string): string {
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
  const off = api.onProgress((p) => b.update(p.current, p.total ? p.index / p.total : 0))
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
  const resolved = await api.resolvePath(destInput, src.path)
  if (!resolved.ok || !resolved.value) {
    await alertBox(t('dlg.error.title'), `${t('err.notFound')}\n${destInput}`)
    return
  }
  const destDir = resolved.value
  const sources = items.map((i) => i.path)
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
  await Promise.all([src.refresh(), dst.refresh()])
  await reportErrors(result)
}

async function makeDir(): Promise<void> {
  const name = await prompt({ title: t('dlg.mkdir.title'), label: t('dlg.mkdir.msg') })
  if (!name) return
  const res = await api.mkdir(active.path, name)
  if (!res.ok) {
    await alertBox(t('dlg.error.title'), res.error === 'invalid-name' ? t('err.invalidName') : (res.error ?? ''))
    return
  }
  await active.load(active.path, { push: false, focusName: name.trim() })
  if (other(active).path === active.path) await other(active).refresh()
}

async function renameCurrent(): Promise<void> {
  const entry = active.currentEntry()
  if (!entry) return
  const name = await prompt({ title: t('dlg.rename.title'), label: t('dlg.rename.msg'), value: entry.name, selectStem: !entry.isDir })
  if (!name || name === entry.name) return
  const res = await api.rename(entry.path, name)
  if (!res.ok) {
    const msg = res.error === 'invalid-name' ? t('err.invalidName') : res.error === 'EEXIST' ? t('dlg.conflict.title') : (res.error ?? '')
    await alertBox(t('dlg.error.title'), msg)
    return
  }
  await active.load(active.path, { push: false, focusName: name.trim() })
  if (other(active).path === active.path) await other(active).refresh()
}

async function trashTargets(): Promise<void> {
  const items = active.targets()
  if (!items.length) return
  if (settings.confirmDelete) {
    const ok = await choose<'ok' | 'cancel'>({
      title: t('dlg.delete.title'),
      message: t('dlg.delete.msg', { n: items.length }),
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
  const hidden = el('input', { type: 'checkbox', checked: settings.showHidden, id: 'set-hidden' })
  const dot = el('input', { type: 'checkbox', checked: settings.showDotFiles, id: 'set-dot' })
  const confirmDel = el('input', { type: 'checkbox', checked: settings.confirmDelete, id: 'set-confirm' })
  const form = el(
    'div',
    {},
    el('div', { class: 'field' }, el('label', { textContent: t('set.lang') }), langSel),
    el('div', { class: 'field' }, el('label', { textContent: t('set.theme') }), themeSel),
    el('div', { class: 'group-label', textContent: t('set.hiddenGroup') }),
    el('label', { class: 'check' }, hidden, t('set.hidden')),
    el('label', { class: 'check' }, dot, t('set.dot')),
    el('div', { class: 'group-sep' }),
    el('label', { class: 'check' }, confirmDel, t('set.confirmDelete'))
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
  settings.showHidden = hidden.checked
  settings.showDotFiles = dot.checked
  settings.confirmDelete = confirmDel.checked
  applyTheme()
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
  await alertBox(t('dlg.about.title'), t('dlg.about.body', { version }))
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
  rename: renameCurrent,
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
  settings: openSettings,
  about: showAbout,
  shortcuts: showShortcuts,
  focusPath: () => active.focusPath(),
  terminal: async () => {
    const res = await api.openTerminal(active.path)
    if (!res.ok) await alertBox(t('dlg.error.title'), t('err.terminal'), `${active.path}\n${res.error ?? ''}`)
  },
  copyPath: copyPaths,
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
  await commands[cmd]?.()
  if (!isModalOpen()) active.focus()
}

// ---------- function key bar ----------

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
  else if (mod && e.shiftKey && k.toLowerCase() === 'c') cmd = 'copyPath'
  else if (e.altKey && !mod && k === 'ArrowDown') cmd = 'history'
  else if (mod && !e.shiftKey && k.toLowerCase() === 'd') cmd = 'favorites'
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
  main.append(...items.map((it) => (it ? button(...it) : el('div', { class: 'tb-sep' }))))
  const foot = el('div', { class: 'tb-foot' }, el('div', { class: 'tb-sep' }), button(...terminal), button(...copyPath), button(...copyList))
  bar.replaceChildren(main, foot)
  updateToolbarDirection()
}

/** Copy/move arrows point from the active pane toward the other pane. */
function updateToolbarDirection(): void {
  document.getElementById('toolbar')!.classList.toggle('to-left', active === panes.right)
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

async function loadPlaces(): Promise<void> {
  const list = await api.places()
  panes.left.setPlaces(list)
  panes.right.setPlaces(list)
}

// ---------- boot ----------

async function boot(): Promise<void> {
  settings = await api.getSettings()
  setLang(settings.lang)
  applyTheme()
  renderFkeys()
  initResize()

  for (const side of ['left', 'right'] as PaneSide[]) {
    const root = document.querySelector<HTMLElement>(`.pane[data-side="${side}"]`)!
    const p = new Pane(root, side, host)
    p.sortKey = settings.panes[side].sortKey
    p.sortAsc = settings.panes[side].sortAsc
    panes[side] = p
  }
  active = panes.left
  panes.left.setActive(true)
  renderToolbar()
  await loadPlaces()

  const fallback = (await api.places())[0]?.path ?? '/'
  for (const side of ['left', 'right'] as PaneSide[]) {
    const ok = await panes[side].load(settings.panes[side].path, { push: false, silent: true })
    if (!ok) await panes[side].load(fallback, { push: false })
  }
  active.focus()

  window.addEventListener('keydown', onKey)
  api.onMenu((cmd) => void run(cmd))
  // Pick up external changes when the window regains focus.
  window.addEventListener('focus', () => {
    if (!operating && !isModalOpen()) {
      void panes.left.refresh()
      void panes.right.refresh()
    }
  })
}

void boot()
