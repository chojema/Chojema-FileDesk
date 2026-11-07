import type { FileEntry, PaneSide, Place, SortKey } from '@shared/types'
import { isRemotePath, remotePath } from '@shared/remote-path'
import { api, collator, el, formatDate, formatSize, icon, isMac, t, type IconName } from './util'

const ROW_H = 26

// System icons are shared by extension; on Windows some types carry their own icon per file.
const iconCache = new Map<string, string>()
const iconPending = new Set<string>()
const ownIcon = /^(exe|lnk|ico|url|scr|msc|cpl|appref-ms)$/i
const PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="none" stroke="#8a8f98" stroke-width="1.2" d="M4 1.6h5.2L12.4 4.8v9.1a.6.6 0 0 1-.6.6H4a.6.6 0 0 1-.6-.6V2.2a.6.6 0 0 1 .6-.6zM9 1.8v3.3h3.2"/></svg>')}`
function iconKey(e: FileEntry): string {
  return api.platform === 'win32' && !isRemotePath(e.path) && ownIcon.test(e.ext) ? e.path : `.${e.ext.toLowerCase()}`
}
const BUFFER = 8

interface Row {
  up?: boolean
  entry?: FileEntry
}

export interface PaneHost {
  activate(pane: Pane): void
  isActive(pane: Pane): boolean
  /** Whether an entry passes the current hidden-item filters. */
  isVisible(entry: FileEntry): boolean
  hiddenShown(): boolean
  toggleHiddenAll(): void
  onOpenFile(entry: FileEntry): void
  onError(message: string): void
  onStateChange(): void
  /** Called after the pane has entered a different folder. */
  onVisited(path: string): void
  isFavorite(path: string): boolean
  openHistory(pane: Pane): void
  openFavorites(pane: Pane): void
  disconnect(pane: Pane): void
  /** A drag of the given items has started from this pane. */
  startDrag(pane: Pane, items: FileEntry[], e: DragEvent): void
  /** Right-click in the list; onRow is false for empty space and "..". */
  contextMenu(pane: Pane, onRow: boolean, extended: boolean): void
}

export class Pane {
  readonly side: PaneSide
  path = ''
  sortKey: SortKey = 'name'
  sortAsc = true

  private entries: FileEntry[] = []
  private rows: Row[] = []
  private cursor = 0
  private selected = new Set<string>()
  private dirSizes = new Map<string, number>()
  private history: string[] = []
  private future: string[] = []
  private anchor = 0
  private typeBuf = ''
  private typeTimer = 0
  private placesList: Place[] = []
  private loadSeq = 0
  private parent: string | null = null
  /** Selected row pressed without modifiers: clear the rest on click, keep it for a drag. */
  private pendingClear = -1
  private dropRow = -1

  private root: HTMLElement
  private placesEl: HTMLElement
  private pathInput: HTMLInputElement
  private backBtn: HTMLButtonElement
  private hiddenBtn: HTMLButtonElement
  readonly historyBtn: HTMLButtonElement
  readonly favBtn: HTMLButtonElement
  private disconnectBtn: HTMLButtonElement
  private fwdBtn: HTMLButtonElement
  private colsEl: HTMLElement
  readonly listEl: HTMLElement
  private innerEl: HTMLElement
  private statusLeft: HTMLElement
  private statusRight: HTMLElement

  constructor(
    root: HTMLElement,
    side: PaneSide,
    private host: PaneHost
  ) {
    this.root = root
    this.side = side

    this.placesEl = el('nav', { class: 'places' })
    this.backBtn = el('button', { class: 'nav-btn', type: 'button', tabIndex: -1 }, icon('back', ''))
    this.fwdBtn = el('button', { class: 'nav-btn', type: 'button', tabIndex: -1 }, icon('forward', ''))
    const upBtn = el('button', { class: 'nav-btn', type: 'button', tabIndex: -1 }, icon('parent', ''))
    this.pathInput = el('input', { class: 'path-input', type: 'text', spellcheck: false, tabIndex: -1 })
    this.hiddenBtn = el('button', { class: 'nav-btn hidden-toggle', type: 'button', tabIndex: -1 })
    this.hiddenBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.hiddenBtn.addEventListener('click', () => this.host.toggleHiddenAll())
    const toolBtn = (cls: string, onClick: () => void) => {
      const b = el('button', { class: `nav-btn ${cls}`, type: 'button', tabIndex: -1 })
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => {
        this.host.activate(this)
        onClick()
      })
      return b
    }
    this.historyBtn = toolBtn('history-btn', () => this.host.openHistory(this))
    this.favBtn = toolBtn('fav-btn', () => this.host.openFavorites(this))
    this.disconnectBtn = toolBtn('disconnect-btn', () => this.host.disconnect(this))
    this.disconnectBtn.append(icon('disconnect', ''))
    this.disconnectBtn.hidden = true
    this.historyBtn.append(icon('clock', ''))
    const pathbar = el(
      'div',
      { class: 'pathbar' },
      this.backBtn,
      this.fwdBtn,
      upBtn,
      this.pathInput,
      this.historyBtn,
      this.favBtn,
      this.hiddenBtn,
      this.disconnectBtn
    )
    this.colsEl = el('div', { class: 'cols' })
    this.innerEl = el('div', { class: 'list-inner' })
    this.listEl = el('div', { class: 'list', tabIndex: 0 }, this.innerEl)
    this.statusLeft = el('span')
    this.statusRight = el('span')
    const status = el('div', { class: 'pane-status' }, this.statusLeft, this.statusRight)
    root.append(this.placesEl, pathbar, this.colsEl, this.listEl, status)

    this.backBtn.addEventListener('click', () => this.goBack())
    this.fwdBtn.addEventListener('click', () => this.goForward())
    upBtn.addEventListener('click', () => this.goParent())
    root.addEventListener('mousedown', () => this.host.activate(this))
    this.listEl.addEventListener('scroll', () => this.renderRows())
    this.listEl.addEventListener('focus', () => this.host.activate(this))
    this.listEl.addEventListener('mousedown', (e) => this.onMouseDown(e))
    this.listEl.addEventListener('click', (e) => {
      const idx = this.pendingClear
      this.pendingClear = -1
      if (idx < 0 || this.rowIndexAt(e) !== idx) return
      this.selected.clear()
      this.updateRowStates()
      void this.updateStatus()
    })
    this.listEl.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const idx = this.rowIndexAt(e)
      const entry = this.rows[idx]?.entry
      this.pendingClear = -1
      this.host.activate(this)
      this.focus()
      if (entry) {
        if (!this.selected.has(entry.path)) this.selected.clear()
        this.cursor = idx
        this.anchor = idx
        this.updateRowStates()
        void this.updateStatus()
      }
      this.host.contextMenu(this, !!entry, e.shiftKey)
    })
    this.listEl.addEventListener('dragstart', (e) => {
      const idx = this.rowIndexAt(e)
      const entry = this.rows[idx]?.entry
      this.pendingClear = -1
      if (!entry) { e.preventDefault(); return }
      if (this.selected.size && !this.selected.has(entry.path)) {
        this.selected.clear()
        this.updateRowStates()
      }
      this.host.startDrag(this, this.targets(), e)
    })
    this.listEl.addEventListener('dblclick', (e) => {
      const idx = this.rowIndexAt(e)
      if (idx >= 0) this.openAt(idx)
    })
    new ResizeObserver(() => this.renderRows()).observe(this.listEl)

    this.pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.navigateInput(this.pathInput.value)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.pathInput.value = this.path
        this.focus()
      }
      e.stopPropagation()
    })
    this.pathInput.addEventListener('blur', () => (this.pathInput.value = this.path))
  }

  // ---------- public API ----------

  focus(): void {
    this.listEl.focus({ preventScroll: true })
  }

  focusPath(): void {
    this.pathInput.focus()
    this.pathInput.select()
  }

  setActive(active: boolean): void {
    this.root.classList.toggle('active', active)
  }

  setPlaces(list: Place[]): void {
    this.placesList = list
    this.renderPlaces()
    this.refreshTools()
  }

  async load(path: string, opts: { push?: boolean; focusName?: string; keepCursor?: boolean; silent?: boolean } = {}): Promise<boolean> {
    const seq = ++this.loadSeq
    const res = await api.listDir(path)
    if (seq !== this.loadSeq) return false
    if (!res.ok || !res.value) {
      if (!opts.silent) this.host.onError(`${t('err.notFound')}\n${path}\n${res.error ?? ''}`)
      return false
    }
    const listing = res.value
    const sameDir = listing.path === this.path
    const prevName = this.rows[this.cursor]?.entry?.name
    if (!sameDir && opts.push !== false && this.path) {
      this.history.push(this.path)
      if (this.history.length > 100) this.history.shift()
      this.future = []
    }
    if (!sameDir) {
      this.selected.clear()
      this.dirSizes.clear()
    }
    this.path = listing.path
    this.parent = listing.parent
    this.entries = listing.entries
    this.rebuild(listing.parent !== null)

    const focusName = opts.focusName ?? (sameDir || opts.keepCursor ? prevName : undefined)
    const idx = focusName ? this.rows.findIndex((r) => r.entry?.name === focusName) : -1
    if (idx >= 0) this.cursor = idx
    else if (!sameDir) this.cursor = 0
    this.cursor = Math.min(this.cursor, Math.max(0, this.rows.length - 1))
    if (!sameDir) this.anchor = this.cursor
    // Drop selections that no longer exist.
    const names = new Set(this.entries.map((e) => e.path))
    for (const p of this.selected) if (!names.has(p)) this.selected.delete(p)

    this.pathInput.value = this.path
    this.backBtn.disabled = this.history.length === 0
    this.fwdBtn.disabled = this.future.length === 0
    this.renderCols()
    this.renderPlaces()
    if (!sameDir) this.listEl.scrollTop = 0
    this.ensureVisible()
    this.renderRows()
    void this.updateStatus()
    if (!sameDir) this.host.onVisited(this.path)
    this.refreshTools()
    this.host.onStateChange()
    return true
  }

  refresh(): Promise<boolean> {
    return this.load(this.path, { push: false, keepCursor: true })
  }

  /** Paths the next operation should act on: the selection (in display order), or the item under the cursor. */
  targets(): FileEntry[] {
    if (this.selected.size) {
      const out: FileEntry[] = []
      for (const r of this.rows) if (r.entry && this.selected.has(r.entry.path)) out.push(r.entry)
      return out
    }
    const cur = this.rows[this.cursor]?.entry
    return cur ? [cur] : []
  }

  /** Entries currently listed (after hidden filters), in display order, without "..". */
  visibleEntries(): FileEntry[] {
    const out: FileEntry[] = []
    for (const r of this.rows) if (r.entry) out.push(r.entry)
    return out
  }

  currentEntry(): FileEntry | undefined {
    return this.rows[this.cursor]?.entry
  }

  rerender(): void {
    this.rebuild(this.rows[0]?.up ?? false)
    this.renderCols()
    this.refreshTools()
    this.renderPlaces()
    this.renderRows()
    void this.updateStatus()
  }

  // ---------- keyboard ----------

  handleKey(e: KeyboardEvent): boolean {
    const mod = isMac ? e.metaKey : e.ctrlKey
    const page = Math.max(1, Math.floor(this.listEl.clientHeight / ROW_H) - 1)
    switch (e.key) {
      case 'ArrowDown':
        if (isMac && e.metaKey) {
          this.openAt(this.cursor)
          return true
        }
        this.moveCursor(1, e.shiftKey)
        return true
      case 'ArrowUp':
        if (isMac && e.metaKey) {
          this.goParent()
          return true
        }
        this.moveCursor(-1, e.shiftKey)
        return true
      case 'PageDown':
        this.moveCursor(page, e.shiftKey)
        return true
      case 'PageUp':
        this.moveCursor(-page, e.shiftKey)
        return true
      case 'Home':
        this.moveCursor(-Infinity, e.shiftKey)
        return true
      case 'End':
        this.moveCursor(Infinity, e.shiftKey)
        return true
      case 'Enter':
        this.openAt(this.cursor)
        return true
      case 'Backspace':
        if (isMac && e.metaKey) return false // Cmd+Backspace = delete (handled by app)
        this.goParent()
        return true
      case ' ':
        this.toggleAt(this.cursor, false)
        return true
      case 'Insert':
        this.toggleAt(this.cursor, true)
        return true
      case 'ArrowLeft':
        if (e.altKey || (isMac && e.metaKey)) {
          this.goBack()
          return true
        }
        return false
      case 'ArrowRight':
        if (e.altKey || (isMac && e.metaKey)) {
          this.goForward()
          return true
        }
        return false
      case '[':
        if (isMac && e.metaKey) {
          this.goBack()
          return true
        }
        return false
      case ']':
        if (isMac && e.metaKey) {
          this.goForward()
          return true
        }
        return false
    }
    if (mod && e.key.toLowerCase() === 'a') {
      this.selectAll()
      return true
    }
    // Type-ahead: jump to the first entry whose name starts with the typed text.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.typeAhead(e.key)
      return true
    }
    return false
  }

  // ---------- navigation ----------

  async navigateInput(input: string): Promise<void> {
    const res = await api.resolvePath(input, this.path)
    if (res.ok && res.value) {
      if (await this.load(res.value)) this.focus()
    } else {
      this.host.onError(`${t('err.notFound')}\n${input}`)
    }
  }

  goParent(): void {
    if (!this.parent) return
    const name = this.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
    void this.load(this.parent, { focusName: name })
  }

  goTop(): void {
    this.moveCursor(-Infinity, false)
  }

  goBottom(): void {
    this.moveCursor(Infinity, false)
  }

  goBack(): void {
    const prev = this.history.pop()
    if (!prev) return
    this.future.push(this.path)
    void this.load(prev, { push: false })
  }

  goForward(): void {
    const next = this.future.pop()
    if (!next) return
    this.history.push(this.path)
    void this.load(next, { push: false })
  }

  private openAt(idx: number): void {
    const row = this.rows[idx]
    if (!row) return
    if (row.up) return this.goParent()
    const entry = row.entry!
    if (entry.isDir) void this.load(entry.path)
    else this.host.onOpenFile(entry)
  }

  // ---------- selection ----------

  private moveCursor(delta: number, extend: boolean): void {
    if (!this.rows.length) return
    const from = this.cursor
    const to = Math.max(0, Math.min(this.rows.length - 1, from + delta))
    if (extend) {
      const [a, b] = from < to ? [from, to] : [to, from]
      for (let i = a; i <= b; i++) {
        const e = this.rows[i].entry
        if (e) this.selected.add(e.path)
      }
    }
    this.cursor = to
    this.ensureVisible()
    this.renderRows()
    if (extend) void this.updateStatus()
  }

  private toggleAt(idx: number, advance: boolean): void {
    const entry = this.rows[idx]?.entry
    if (entry) {
      if (this.selected.has(entry.path)) this.selected.delete(entry.path)
      else {
        this.selected.add(entry.path)
        if (entry.isDir && !this.dirSizes.has(entry.path)) {
          // Like classic commanders: selecting a folder calculates its size.
          void api.dirSize(entry.path).then((size) => {
            this.dirSizes.set(entry.path, size)
            this.renderRows()
            void this.updateStatus()
          })
        }
      }
    }
    if (advance) this.moveCursor(1, false)
    else this.renderRows()
    void this.updateStatus()
  }

  private selectAll(): void {
    const all = this.entries.filter((e) => this.host.isVisible(e))
    if (this.selected.size === all.length) this.selected.clear()
    else all.forEach((e) => this.selected.add(e.path))
    this.renderRows()
    void this.updateStatus()
  }

  private typeAhead(ch: string): void {
    window.clearTimeout(this.typeTimer)
    this.typeBuf += ch.toLowerCase()
    this.typeTimer = window.setTimeout(() => (this.typeBuf = ''), 700)
    const idx = this.rows.findIndex((r) => r.entry?.name.toLowerCase().startsWith(this.typeBuf))
    if (idx >= 0) {
      this.cursor = idx
      this.ensureVisible()
      this.renderRows()
    }
  }

  // ---------- mouse ----------

  private rowIndexAt(e: MouseEvent): number {
    const element = e.target instanceof Element ? e.target.closest<HTMLElement>('.row') : null
    if (!element || !this.innerEl.contains(element)) return -1
    const idx = Number(element.dataset.rowIndex)
    return Number.isInteger(idx) && idx >= 0 && idx < this.rows.length ? idx : -1
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    const idx = this.rowIndexAt(e)
    if (idx < 0) return
    // No preventDefault: it would stop rows from being dragged. Rows are not text-selectable.
    this.host.activate(this)
    this.focus()
    const toggle = isMac ? e.metaKey : e.ctrlKey
    if (e.shiftKey) {
      const anchor = Math.max(0, Math.min(this.anchor, this.rows.length - 1))
      const [a, b] = anchor < idx ? [anchor, idx] : [idx, anchor]
      if (!toggle) this.selected.clear()
      for (let i = a; i <= b; i++) {
        const en = this.rows[i].entry
        if (en) this.selected.add(en.path)
      }
    } else if (toggle) {
      const en = this.rows[idx].entry
      if (en) this.selected.has(en.path) ? this.selected.delete(en.path) : this.selected.add(en.path)
      this.anchor = idx
    } else {
      const en = this.rows[idx].entry
      if (en && this.selected.has(en.path)) this.pendingClear = idx
      else this.selected.clear()
      this.anchor = idx
    }
    this.cursor = idx
    // Keep pointer targets alive between down/up and both clicks of a double-click.
    // Replacing rows here prevents Chromium from dispatching click/dblclick.
    this.updateRowStates()
    void this.updateStatus()
  }

  /** Folder a drop at this point goes into: the folder row under the pointer, or the current folder. */
  dropDir(e: DragEvent): string {
    const entry = this.rows[this.rowIndexAt(e)]?.entry
    return entry?.isDir && !entry.isSymlink ? entry.path : this.path
  }

  /** Highlights the pane or the folder row a drop would go into; null clears it. */
  markDrop(e: DragEvent | null): void {
    const idx = e ? this.rowIndexAt(e) : -1
    const entry = this.rows[idx]?.entry
    this.dropRow = entry?.isDir && !entry.isSymlink ? idx : -1
    this.root.classList.toggle('drop-target', !!e && this.dropRow < 0)
    this.updateRowStates()
  }

  private updateRowStates(): void {
    for (const element of this.innerEl.children) {
      const div = element as HTMLElement
      const idx = Number(div.dataset.rowIndex)
      const entry = this.rows[idx]?.entry
      div.classList.toggle('cursor', idx === this.cursor)
      div.classList.toggle('selected', !!entry && this.selected.has(entry.path))
      div.classList.toggle('drop-target', idx === this.dropRow)
    }
  }

  // ---------- rendering ----------

  private rebuild(hasParent: boolean): void {
    const list = this.entries.filter((e) => this.host.isVisible(e))
    const dir = this.sortAsc ? 1 : -1
    const key = this.sortKey
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      let r = 0
      if (key === 'ext') r = collator.compare(a.ext, b.ext)
      else if (key === 'size') r = a.size - b.size
      else if (key === 'mtime') r = a.mtime - b.mtime
      if (r === 0) r = collator.compare(a.name, b.name)
      return r * dir
    })
    this.rows = (hasParent ? [{ up: true } as Row] : []).concat(list.map((entry) => ({ entry })))
    // Items that just became hidden must not stay selected (they would be copied/deleted invisibly).
    for (const e of this.entries) if (!this.host.isVisible(e)) this.selected.delete(e.path)
  }

  /** Updates the path-bar tool buttons (hidden toggle, history, favorite state, tooltips). */
  refreshTools(): void {
    this.renderHiddenBtn()
    const fav = this.host.isFavorite(this.path)
    this.favBtn.replaceChildren(icon(fav ? 'starFill' : 'star', ''))
    this.favBtn.classList.toggle('on', fav)
    this.favBtn.title = `${t('tb.favorites')} (${isMac ? '⌘D' : 'Ctrl+D'})`
    this.historyBtn.title = `${t('tb.history')} (${isMac ? '⌥↓' : 'Alt+↓'})`
    this.disconnectBtn.title = t('server.disconnect')
    this.disconnectBtn.setAttribute('aria-label', t('server.disconnect'))
    this.disconnectBtn.hidden = !isRemotePath(this.path) || !this.placesList.some(p =>
      p.kind === 'server' && remotePath(p.path).key === remotePath(this.path).key)
  }

  private renderHiddenBtn(): void {
    const shown = this.host.hiddenShown()
    this.hiddenBtn.replaceChildren(icon(shown ? 'eye' : 'eyeOff', ''))
    this.hiddenBtn.classList.toggle('on', shown)
    this.hiddenBtn.title = t('tip.hidden', { key: isMac ? '⌘.' : 'Ctrl+.' })
  }

  private renderCols(): void {
    const cols: [SortKey, string, string][] = [
      ['name', t('col.name'), ''],
      ['ext', t('col.ext'), ''],
      ['size', t('col.size'), 'num'],
      ['mtime', t('col.date'), '']
    ]
    this.colsEl.replaceChildren(
      ...cols.map(([key, label, cls]) => {
        const sorted = this.sortKey === key
        const c = el('div', {
          class: `${cls} ${sorted ? 'sorted' : ''}`,
          textContent: sorted ? `${label} ${this.sortAsc ? '↑' : '↓'}` : label
        })
        c.addEventListener('click', () => {
          if (this.sortKey === key) this.sortAsc = !this.sortAsc
          else {
            this.sortKey = key
            this.sortAsc = key === 'name' || key === 'ext'
          }
          const name = this.currentEntry()?.name
          this.rebuild(this.rows[0]?.up ?? false)
          const idx = name ? this.rows.findIndex((r) => r.entry?.name === name) : -1
          this.cursor = idx >= 0 ? idx : 0
          this.renderCols()
          this.ensureVisible()
          this.renderRows()
          this.host.onStateChange()
        })
        return c
      })
    )
  }

  private renderPlaces(): void {
    const iconFor: Record<Place['kind'], IconName> = { drive: 'drive', volume: 'drive', home: 'home', folder: 'star', server: 'drive' }
    const current = this.placesList
      .filter((p) => this.path.toLowerCase().startsWith(p.path.toLowerCase()))
      .sort((a, b) => b.path.length - a.path.length)[0]
    this.placesEl.replaceChildren(
      ...this.placesList.map((p) => {
        const b = el('button', { class: `place ${current?.id === p.id ? 'current' : ''}`, type: 'button', tabIndex: -1, title: p.path })
        b.append(icon(iconFor[p.kind], ''), el('span', { textContent: p.label }))
        b.addEventListener('click', () => {
          void this.load(p.path).then(() => this.focus())
        })
        return b
      })
    )
  }

  private ensureVisible(): void {
    const top = this.cursor * ROW_H
    const view = this.listEl.clientHeight
    if (top < this.listEl.scrollTop) this.listEl.scrollTop = top
    else if (top + ROW_H > this.listEl.scrollTop + view) this.listEl.scrollTop = top + ROW_H - view
  }

  private renderRows(): void {
    this.innerEl.style.height = `${this.rows.length * ROW_H}px`
    const start = Math.max(0, Math.floor(this.listEl.scrollTop / ROW_H) - BUFFER)
    const end = Math.min(this.rows.length, Math.ceil((this.listEl.scrollTop + this.listEl.clientHeight) / ROW_H) + BUFFER)
    const frag = document.createDocumentFragment()
    for (let i = start; i < end; i++) frag.append(this.renderRow(i))
    this.innerEl.replaceChildren(frag)
  }

  private renderRow(i: number): HTMLElement {
    const row = this.rows[i]
    const div = el('div', { class: 'row' })
    div.dataset.rowIndex = String(i)
    div.style.top = `${i * ROW_H}px`
    if (i === this.cursor) div.classList.add('cursor')
    if (i === this.dropRow) div.classList.add('drop-target')
    if (row.up) {
      div.classList.add('dir')
      div.append(
        el('div', { class: 'name' }, icon('up'), el('span', { textContent: '..' })),
        el('div', { class: 'meta' }),
        el('div', { class: 'meta num', textContent: t('dir') }),
        el('div', { class: 'meta' })
      )
      return div
    }
    const e = row.entry!
    div.draggable = true
    if (e.isDir) div.classList.add('dir')
    if (e.hidden || e.dot) div.classList.add('hidden-entry')
    if (this.selected.has(e.path)) div.classList.add('selected')
    const size = e.isDir ? (this.dirSizes.has(e.path) ? formatSize(this.dirSizes.get(e.path)!) : t('dir')) : formatSize(e.size)
    const name = el('span', { textContent: e.isDir || !e.ext ? e.name : e.name.slice(0, -(e.ext.length + 1)) })
    div.title = e.name
    div.append(
      el('div', { class: 'name' }, e.isDir || e.isSymlink ? icon(e.isSymlink ? 'link' : 'folder') : this.fileIcon(e), name),
      el('div', { class: 'meta', textContent: e.ext }),
      el('div', { class: 'meta num', textContent: size }),
      el('div', { class: 'meta', textContent: formatDate(e.mtime) })
    )
    return div
  }

  private fileIcon(e: FileEntry): Element {
    const key = iconKey(e)
    const img = el('img', { class: 'icon sys-icon', src: iconCache.get(key) || PLACEHOLDER, alt: '', draggable: false })
    img.dataset.iconKey = key
    if (!iconCache.has(key) && !iconPending.has(key)) {
      iconPending.add(key)
      void api.fileIcon(e.path).then((data) => {
        iconCache.set(key, data)
        iconPending.delete(key)
        if (!data) return
        // Swap the image source in place so rows under the pointer stay the same nodes.
        for (const node of this.innerEl.querySelectorAll<HTMLImageElement>('img.sys-icon')) if (node.dataset.iconKey === key) node.src = data
      })
    }
    return img
  }

  private async updateStatus(): Promise<void> {
    const visible = this.rows.filter((r) => r.entry).length
    const hiddenCount = this.entries.length - visible
    if (this.selected.size) {
      let bytes = 0
      for (const e of this.entries) if (this.selected.has(e.path)) bytes += e.isDir ? (this.dirSizes.get(e.path) ?? 0) : e.size
      this.statusLeft.textContent = t('status.selected', { n: this.selected.size, size: formatSize(bytes) })
    } else {
      this.statusLeft.textContent =
        t('status.items', { n: visible }) + (hiddenCount > 0 ? ` · ${t('status.hiddenCount', { n: hiddenCount })}` : '')
    }
    const path = this.path
    const space = await api.diskSpace(path)
    if (path !== this.path) return
    this.statusRight.textContent = space ? t('status.free', { free: formatSize(space.free), total: formatSize(space.total) }) : ''
  }
}
