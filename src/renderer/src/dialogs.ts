import { el, icon, t, type IconName } from './util'

export interface ButtonSpec<T extends string> {
  id: T
  label: string
  kind?: 'primary' | 'danger'
}

const root = () => document.getElementById('modal-root')!
let openCount = 0
export const isModalOpen = (): boolean => openCount > 0

function mount(content: HTMLElement, onKey: (e: KeyboardEvent) => void): () => void {
  const prevFocus = document.activeElement as HTMLElement | null
  const overlay = el('div', { class: 'overlay' }, content)
  const keyHandler = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Tab') trapTab(e, content)
    onKey(e)
  }
  overlay.addEventListener('keydown', keyHandler)
  root().append(overlay)
  openCount++
  let mounted = true
  return () => {
    if (!mounted) return
    mounted = false
    overlay.remove()
    openCount--
    prevFocus?.focus()
  }
}

function trapTab(e: KeyboardEvent, box: HTMLElement): void {
  const items = [...box.querySelectorAll<HTMLElement>('button, input, select')].filter((x) => !x.hasAttribute('disabled') && x.getClientRects().length > 0)
  if (!items.length) return
  const idx = items.indexOf(document.activeElement as HTMLElement)
  const next = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : idx === items.length - 1 ? 0 : idx + 1
  items[next].focus()
  e.preventDefault()
}

/** Generic button dialog. Escape resolves to `cancelId`. */
export function choose<T extends string>(opts: {
  title: string
  message?: string
  detail?: string
  buttons: ButtonSpec<T>[]
  cancelId: T
  extra?: HTMLElement
}): Promise<T> {
  return new Promise((resolve) => {
    const box = el('div', { class: 'modal', role: 'dialog' }, el('h2', { textContent: opts.title }))
    if (opts.message) box.append(el('p', { textContent: opts.message }))
    if (opts.detail) box.append(el('div', { class: 'detail', textContent: opts.detail }))
    if (opts.extra) box.append(opts.extra)
    const bar = el('div', { class: 'buttons' })
    let close = () => {}
    const finish = (id: T) => {
      close()
      resolve(id)
    }
    const btns = opts.buttons.map((b) => {
      const btn = el('button', { class: `btn ${b.kind ?? ''}`, textContent: b.label, type: 'button' })
      btn.addEventListener('click', () => finish(b.id))
      bar.append(btn)
      return { spec: b, btn }
    })
    box.append(bar)
    close = mount(box, (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(opts.cancelId)
      }
    })
    const primary = btns.find((x) => x.spec.kind) ?? btns[0]
    primary?.btn.focus()
  })
}

export async function alertBox(title: string, message: string, detail?: string): Promise<void> {
  await choose({ title, message, detail, buttons: [{ id: 'ok', label: t('btn.ok'), kind: 'primary' }], cancelId: 'ok' })
}

/** Text prompt. Returns null on cancel. `selectStem` pre-selects the name without its extension. */
export function prompt(opts: {
  title: string
  label: string
  value?: string
  message?: string
  selectStem?: boolean
}): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el('input', { type: 'text', value: opts.value ?? '', spellcheck: false })
    const field = el('div', { class: 'field' }, el('label', { textContent: opts.label }), input)
    const box = el('form', { class: 'modal', role: 'dialog' }, el('h2', { textContent: opts.title }))
    if (opts.message) box.append(el('p', { textContent: opts.message }))
    box.append(field)
    const cancel = el('button', { class: 'btn', type: 'button', textContent: t('btn.cancel') })
    const ok = el('button', { class: 'btn primary', type: 'submit', textContent: t('btn.ok') })
    box.append(el('div', { class: 'buttons' }, cancel, ok))
    let done = false
    const finish = (v: string | null) => {
      if (done) return
      done = true
      close()
      resolve(v)
    }
    box.addEventListener('submit', (e) => {
      e.preventDefault()
      finish(input.value)
    })
    cancel.addEventListener('click', () => finish(null))
    const close = mount(box, (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    })
    input.focus()
    const v = input.value
    const dot = v.lastIndexOf('.')
    if (opts.selectStem && dot > 0) input.setSelectionRange(0, dot)
    else input.select()
  })
}

/** Non-blocking progress overlay. */
export function busy(title: string): { update(text: string, ratio: number): void; close(): void } {
  const text = el('p', { textContent: '' })
  const bar = el('div')
  const box = el('div', { class: 'modal', role: 'dialog' }, el('h2', { textContent: title }), text, el('div', { class: 'progress' }, bar))
  let close: (() => void) | null = null
  // Only show the overlay if the operation takes noticeable time.
  const timer = window.setTimeout(() => {
    close = mount(box, (e) => e.preventDefault())
  }, 250)
  return {
    update(s, ratio) {
      text.textContent = s
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`
    },
    close() {
      window.clearTimeout(timer)
      close?.()
    }
  }
}

// ---------- dropdown popup ----------

export interface PopupItem {
  label: string
  detail?: string
  icon?: IconName
  /** Action rows (e.g. "Add to favorites") are styled differently from folder rows. */
  action?: boolean
  /** Shown as a non-interactive line (e.g. "No favorites"). */
  disabled?: boolean
  separatorBefore?: boolean
  onSelect?: () => void
  /** When set, the row gets a remove button and responds to Delete. */
  onRemove?: () => void
}

/**
 * Opens a keyboard-navigable dropdown below `anchor`, right-aligned to it.
 * `build` is called again after a removal so the list stays current.
 */
export function popup(anchor: HTMLElement, title: string, build: () => PopupItem[]): void {
  const prevFocus = document.activeElement as HTMLElement | null
  const backdrop = el('div', { class: 'popup-backdrop' })
  const menu = el('div', { class: 'popup', role: 'menu', tabIndex: -1 })
  backdrop.append(menu)
  let items: PopupItem[] = []
  let focus = -1
  let rows: HTMLElement[] = []

  let closed = false
  const close = (restoreFocus = true) => {
    if (closed) return
    closed = true
    document.removeEventListener('mousedown', outside, true)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('resize', onBlur)
    backdrop.remove()
    openCount--
    if (restoreFocus) prevFocus?.focus()
  }
  // Any click outside the list closes it and still reaches what was clicked;
  // a click on the button that opened it only closes it.
  const outside = (e: MouseEvent) => {
    const target = e.target as Node
    if (menu.contains(target)) return
    if (anchor.contains(target)) {
      e.preventDefault()
      e.stopPropagation()
      const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation() }
      document.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => document.removeEventListener('click', swallow, true), 600)
    }
    close(false)
  }
  const onBlur = () => close(false)

  const selectable = (i: number) => !!items[i] && !items[i].disabled
  const setFocus = (i: number) => {
    focus = i
    rows.forEach((r, j) => r.classList.toggle('focused', j === i))
    rows[i]?.scrollIntoView({ block: 'nearest' })
  }
  const move = (dir: 1 | -1) => {
    if (!items.some((_, i) => selectable(i))) return
    let i = focus
    do {
      i = (i + dir + items.length) % items.length
    } while (!selectable(i))
    setFocus(i)
  }
  const choose = (i: number) => {
    const it = items[i]
    if (!it || it.disabled) return
    close()
    it.onSelect?.()
  }
  const remove = (i: number) => {
    const it = items[i]
    if (!it?.onRemove) return
    it.onRemove()
    render(Math.min(i, items.length - 1))
  }

  const render = (focusIndex?: number) => {
    items = build()
    menu.replaceChildren(el('div', { class: 'popup-title', textContent: title }))
    rows = items.map((it, i) => {
      if (it.separatorBefore) menu.append(el('div', { class: 'popup-sep' }))
      const row = el('div', { class: `popup-row ${it.action ? 'action' : ''} ${it.disabled ? 'disabled' : ''}`, role: 'menuitem' })
      if (it.icon) row.append(icon(it.icon, 'popup-icon'))
      const text = el('div', { class: 'popup-text' }, el('div', { class: 'popup-label', textContent: it.label }))
      if (it.detail) text.append(el('div', { class: 'popup-detail', textContent: it.detail }))
      row.append(text)
      if (it.detail) row.title = it.detail
      if (it.onRemove) {
        const x = el('button', { class: 'popup-remove', type: 'button', tabIndex: -1, title: t('popup.remove'), textContent: '×' })
        x.addEventListener('click', (e) => {
          e.stopPropagation()
          remove(i)
        })
        row.append(x)
      }
      row.addEventListener('mousemove', () => selectable(i) && focus !== i && setFocus(i))
      row.addEventListener('click', () => choose(i))
      menu.append(row)
      return row
    })
    const first = items.findIndex((_, i) => selectable(i))
    const want = focusIndex !== undefined && selectable(focusIndex) ? focusIndex : first
    setFocus(want)
  }

  backdrop.addEventListener('keydown', (e) => {
    e.stopPropagation()
    const handled = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Delete', 'Home', 'End', 'Tab'].includes(e.key)
    if (handled) e.preventDefault()
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Home') setFocus(items.findIndex((_, i) => selectable(i)))
    else if (e.key === 'End') setFocus(items.map((_, i) => selectable(i)).lastIndexOf(true))
    else if (e.key === 'Enter') choose(focus)
    else if (e.key === 'Delete') remove(focus)
    else if (e.key === 'Escape' || e.key === 'Tab') close()
  })

  root().append(backdrop)
  openCount++
  document.addEventListener('mousedown', outside, true)
  window.addEventListener('blur', onBlur)
  window.addEventListener('resize', onBlur)
  render()

  // Position: below the anchor, right edges aligned, kept inside the window.
  const a = anchor.getBoundingClientRect()
  const w = menu.offsetWidth
  const left = Math.max(8, Math.min(a.right - w, window.innerWidth - w - 8))
  const top = a.bottom + 4
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`
  menu.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`
  menu.focus()
}
