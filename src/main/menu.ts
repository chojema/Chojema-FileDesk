import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { APP_LINKS } from '@shared/links'
import { translate, type MsgKey } from '@shared/i18n'
import type { Settings } from '@shared/types'

const isMac = process.platform === 'darwin'

export function buildMenu(win: BrowserWindow, settings: Settings, connected = false): void {
  const t = (k: MsgKey) => translate(settings.lang, k)
  // Keyboard handling lives in the renderer; accelerators here are shown for reference only.
  const cmd = (label: MsgKey, id: string, accelerator?: string): MenuItemConstructorOptions => ({
    label: t(label),
    accelerator,
    registerAccelerator: false,
    click: () => win.webContents.send('menu', id)
  })

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        cmd('menu.about', 'about'),
        { type: 'separator' },
        cmd('menu.settings', 'settings', 'Cmd+,'),
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit') }
      ]
    })
  }

  template.push({
    label: t('menu.file'),
    submenu: [
      cmd('menu.newFolder', 'mkdir', 'F7'),
      cmd('menu.rename', 'rename', 'F2'),
      { type: 'separator' },
      cmd('menu.copy', 'copy', 'F5'),
      cmd('menu.move', 'move', 'F6'),
      cmd('menu.trash', 'trash', 'F8'),
      { type: 'separator' },
      cmd('menu.reveal', 'reveal'),
      cmd('tb.terminal', 'terminal'),
      cmd('tb.copyPath', 'copyPath', 'CmdOrCtrl+Shift+C'),
      cmd('tb.copyList', 'copyList'),
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            cmd('menu.settings', 'settings', 'Ctrl+,'),
            { type: 'separator' },
            { role: 'quit', label: t('menu.quit') }
          ] as MenuItemConstructorOptions[]))
    ]
  })

  template.push({
    label: t('menu.edit'),
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  })

  template.push({
    label: t('menu.view'),
    submenu: [
      cmd('menu.refresh', 'refresh', 'CmdOrCtrl+R'),
      cmd('tb.history', 'history', 'Alt+Down'),
      cmd('tb.favorites', 'favorites', 'CmdOrCtrl+D'),
      { type: 'separator' },
      cmd('menu.hiddenAll', 'toggleHiddenAll', 'CmdOrCtrl+.'),
      { ...cmd('menu.hidden', 'toggleHidden'), type: 'checkbox', checked: settings.showHidden },
      { ...cmd('menu.dot', 'toggleDot'), type: 'checkbox', checked: settings.showDotFiles },
      { type: 'separator' },
      cmd('menu.swap', 'swap', 'CmdOrCtrl+U'),
      cmd('menu.sameDir', 'sameDir', 'CmdOrCtrl+='),
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : ([{ role: 'toggleDevTools', label: t('menu.devtools') }] as MenuItemConstructorOptions[]))
    ]
  })

  template.push({
    id: 'server-menu',
    label: t('menu.server'),
    submenu: [
      { ...cmd('server.connect', 'connect', 'CmdOrCtrl+K'), id: 'server-connect' },
      { ...cmd('server.disconnect', 'disconnect'), id: 'server-disconnect', enabled: connected }
    ]
  })

  template.push({
    label: t('menu.info'),
    submenu: [
      cmd('menu.about', 'about'), cmd('update.check', 'checkUpdate'), cmd('menu.shortcuts', 'shortcuts'),
      { type: 'separator' },
      ...APP_LINKS.map(link => ({ label: link.label, click: () => { void shell.openExternal(link.url) } }))
    ]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
