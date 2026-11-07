// Run: npm run test:mouse -- <packaged app executable> [renderer index.html]
// FILEDESK_TEST_APP and FILEDESK_TEST_RENDERER are also accepted for CI.
// The win32 case uses the same production preload/renderer with its platform flag
// changed in a temporary preload; it does not claim to replace native Windows QA.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const binary = process.argv[2] || process.env.FILEDESK_TEST_APP
const rendererFile = process.argv[3] || process.env.FILEDESK_TEST_RENDERER
if (!binary) throw new Error('Set FILEDESK_TEST_APP to the packaged app executable')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'filedesk-mouse-'))
const left = path.join(work, 'left'), right = path.join(work, 'right'), user = path.join(work, 'user')
for (const dir of [left, right, user]) fs.mkdirSync(dir)
fs.mkdirSync(path.join(left, '01 Folder'))
fs.writeFileSync(path.join(left, '01 Folder', 'inside.txt'), 'inside')
fs.writeFileSync(path.join(left, '02 File.txt'), 'test')
fs.writeFileSync(path.join(left, '03 Other.txt'), 'other')
for (let i = 0; i < 180; i++) fs.writeFileSync(path.join(left, `item-${String(i).padStart(3, '0')}.txt`), String(i))
for (const file of ['Right-1.txt', 'Right-2.txt']) fs.writeFileSync(path.join(right, file), file)
const settings = { lang: 'en', theme: 'light', showHidden: false, showDotFiles: false, confirmDelete: true, checkUpdatesOnStart: false, recentDirs: [], favorites: [], panes: { left: { path: left, sortKey: 'name', sortAsc: true }, right: { path: right, sortKey: 'name', sortAsc: true } } }
fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify(settings))
const log = fs.openSync(path.join(work, 'app.log'), 'w')
const child = spawn(binary, [`--user-data-dir=${user}`, '--remote-debugging-port=19581', '--inspect=19582'], { stdio: ['ignore', log, log] })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const sockets = [], results = []
async function until(fn, label) {
  for (let i = 0; i < 300; i++) { if (await fn()) return; if (child.exitCode !== null) throw new Error('App exited'); await pause(100) }
  throw new Error(`Timed out: ${label}`)
}
async function targets(port) { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) }
async function client(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map()
  sockets.push(socket)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let serial = 0
  socket.onmessage = e => {
    const m = JSON.parse(e.data), request = pending.get(m.id)
    if (request) { clearTimeout(request.timer); pending.delete(m.id); m.error ? request.reject(new Error(JSON.stringify(m.error))) : request.resolve(m.result) }
  }
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  return { call, evaluate }
}
let main
async function testPlatform(platform, target, native = false) {
  const c = await client(target), ev = c.evaluate, call = c.call
  const checks = [], host = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform
  const name = native ? `${host} native` : `Windows renderer on ${host}`
  const pass = label => { checks.push(label); console.log(`PASS ${name}: ${label}`) }
  try {
    await until(() => ev('!!window.filedesk && !!document.querySelector(\'.pane[data-side="left"] .row[title="02 File.txt"]\')'), 'fixture rows')
    assert.equal(await ev('window.filedesk.platform'), platform)
    await call('Page.enable')
    await ev(`window.__pointerTrace=[];for(const type of ['mousedown','mouseup','click','dblclick'])document.addEventListener(type,e=>{window.__pointerTrace.push({type,detail:e.detail,trusted:e.isTrusted});if(type==='mousedown')window.__pressed=e.target},true)`)
    const point = async (side, title, part = '.name span') => ev(`(() => {
      const row=[...document.querySelectorAll('.pane[data-side="${side}"] .row')].find(x=>${title === '..' ? "x.querySelector('.name span')?.textContent==='..'" : `x.title===${JSON.stringify(title)}`});
      if(!row)throw new Error('Missing row');const r=(row.querySelector(${JSON.stringify(part)})||row).getBoundingClientRect();return {x:r.x+Math.min(10,r.width/2),y:r.y+r.height/2}
    })()`)
    const click = async (position, count = 1, modifiers = 0, button = 'left') => {
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button, clickCount: count, modifiers })
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button, clickCount: count, modifiers })
      await pause(40)
    }
    const doubleClick = async (side, title, part) => { const p = await point(side, title, part); await click(p); await click(p, 2); await pause(100) }
    const state = side => ev(`({cursor:document.querySelector('.pane[data-side="${side}"] .row.cursor')?.title,focus:document.activeElement===document.querySelector('.pane[data-side="${side}"] .list'),active:document.querySelector('.pane[data-side="${side}"]').classList.contains('active')})`)
    const current = side => ev(`document.querySelector('.pane[data-side="${side}"] .path-input').value`)
    await pause(150)
    await click(await point('left', '02 File.txt'))
    assert.equal(await ev('window.__pressed.isConnected'), true, 'mousedown must keep the pointed-to DOM node alive')
    assert.deepEqual(await state('left'), { cursor: '02 File.txt', focus: true, active: true })
    assert.ok((await ev('window.__pointerTrace')).some(e => e.type === 'click' && e.trusted))
    pass('real down/up keeps the row, highlights it and focuses the pane')
    const mod = platform === 'darwin' ? 4 : 2
    await click(await point('left', '03 Other.txt'), 1, mod)
    await click(await point('left', '02 File.txt'), 1, mod)
    assert.deepEqual(await ev(`[...document.querySelectorAll('.pane[data-side="left"] .row.selected')].map(x=>x.title).sort()`), ['02 File.txt', '03 Other.txt'])
    await click(await point('left', '02 File.txt'))
    await click(await point('left', 'item-001.txt'), 1, 8)
    assert.equal(await ev(`document.querySelectorAll('.pane[data-side="left"] .row.selected').length`), 4)
    pass('Ctrl/Cmd toggles and Shift range selection')
    await doubleClick('left', '01 Folder', '.name .icon')
    assert.equal(await current('left'), path.join(left, '01 Folder'))
    await doubleClick('left', '..')
    assert.equal(await current('left'), left)
    pass('double-click opens folders and the parent row, including icon clicks')
    await main(`globalThis.__mouseOpens=[]`)
    await doubleClick('left', '02 File.txt')
    await until(async () => (await main('globalThis.__mouseOpens.length')) > 0, 'file open IPC')
    assert.deepEqual(await main('globalThis.__mouseOpens'), [path.join(left, '02 File.txt')])
    pass('file double-click reaches the real shell-open IPC exactly once')
    await click(await point('right', 'Right-1.txt'))
    assert.deepEqual(await state('right'), { cursor: 'Right-1.txt', focus: true, active: true })
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    assert.equal((await state('right')).cursor, 'Right-2.txt')
    pass('switching pane by mouse preserves keyboard focus')
    const empty = await ev(`(() => {const r=document.querySelector('.pane[data-side="right"] .list').getBoundingClientRect();return {x:r.x+100,y:r.bottom-30}})()`)
    await click(empty)
    assert.equal((await state('right')).cursor, 'Right-2.txt')
    await click(await point('right', 'Right-1.txt'), 1, 0, 'right')
    assert.equal((await state('right')).cursor, 'Right-2.txt')
    pass('blank space and non-primary clicks do not select another row')
    const list = await ev(`(() => {const r=document.querySelector('.pane[data-side="left"] .list').getBoundingClientRect();return {x:r.x+100,y:r.y+100}})()`)
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...list, deltaX: 0, deltaY: 2300 })
    await until(() => ev(`document.querySelector('.pane[data-side="left"] .list').scrollTop > 500`), 'virtual list scroll')
    await pause(100)
    const visible = await ev(`(() => {const list=document.querySelector('.pane[data-side="left"] .list');const b=list.getBoundingClientRect();return [...list.querySelectorAll('.row')].find(x=>{const r=x.getBoundingClientRect();return x.title&&r.top>b.top+30&&r.bottom<b.bottom-10}).title})()`)
    await click(await point('left', visible, '.meta.num'))
    assert.equal((await state('left')).cursor, visible)
    assert.equal(await ev('window.__pressed.isConnected'), true)
    pass('scrolled virtual rows and non-name columns select the correct item')
    await main(`globalThis.__mouseWindow.webContents.setZoomFactor(1.25)`)
    await pause(150)
    const zoomed = await ev(`(() => {const list=document.querySelector('.pane[data-side="left"] .list');const b=list.getBoundingClientRect();return [...list.querySelectorAll('.row')].find(x=>{const r=x.getBoundingClientRect();return x.title&&r.top>b.top+30&&r.bottom<b.bottom-10}).title})()`)
    await click(await point('left', zoomed))
    assert.equal((await state('left')).cursor, zoomed)
    pass('mouse hit testing at 125% zoom')
    await ev(`{const input=document.querySelector('.pane[data-side="left"] .path-input');input.focus();input.select()}`)
    await call('Input.insertText', { text: path.join(left, '01 Folder') })
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await until(() => ev(`!![...document.querySelectorAll('.pane[data-side="left"] .row')].find(x=>x.title==='inside.txt')`), 'directory after scrolled selection')
    assert.equal(await current('left'), path.join(left, '01 Folder'))
    await click(await point('left', 'inside.txt'), 1, 8)
    assert.equal(await ev(`document.querySelectorAll('.pane[data-side="left"] .row.selected').length`), 1)
    pass('Shift selection resets its anchor after changing folders')
    const screenshot = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(work, `${platform}.png`), Buffer.from(screenshot.data, 'base64'))
    results.push({ platform, environment: name, checks, passed: true })
  } catch (e) {
    results.push({ platform, environment: name, checks, passed: false, error: e.message, trace: await ev('window.__pointerTrace').catch(() => null) })
    console.error(`FAIL ${name}: ${e.message}`)
  }
}
try {
  let target
  await until(async () => { try { target = (await targets(19582))[0]; return !!target } catch { return false } }, 'main inspector')
  main = (await client(target)).evaluate
  assert.equal(await main('process.pid'), child.pid, 'Inspector must belong to this test process')
  await main(`globalThis.__mouseRequire=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');globalThis.__mouseWindow=__mouseRequire('electron').BrowserWindow.getAllWindows()[0];globalThis.__mouseOpens=[];__mouseRequire('electron').shell.openPath=async p=>{__mouseOpens.push(p);return ''};true`)
  await until(() => main(`__mouseRequire('electron').BrowserWindow.getAllWindows().length>0`), 'main window')
  await main(`globalThis.__mouseWindow=__mouseRequire('electron').BrowserWindow.getAllWindows()[0];true`)
  let renderer
  await until(async () => { try { renderer = (await targets(19581)).find(t => t.type === 'page'); return !!renderer } catch { return false } }, 'renderer')
  const initial = await client(renderer)
  await until(async () => { try { return await initial.evaluate('document.querySelectorAll(".row").length>4') } catch { return false } }, 'initial application load')
  if (rendererFile) await main(`__mouseWindow.loadFile(${JSON.stringify(path.resolve(rendererFile))})`)
  await testPlatform(process.platform, renderer, true)
  if (process.platform !== 'win32') {
  const original = await main(`__mouseRequire('node:fs').readFileSync(process.resourcesPath+'/app.asar/out/preload/index.js','utf8')`)
  assert.ok(original.includes('platform: process.platform'))
  const preload = path.join(work, 'win32-preload.js')
  fs.writeFileSync(preload, original.replace('platform: process.platform', 'platform: "win32"'))
  const c = await client(renderer)
  // Let the production window finish its debounced settings save before
  // seeding an independent Windows-branch test window.
  await pause(550)
  await c.evaluate(`window.filedesk.saveSettings(${JSON.stringify(settings)})`)
  const ids = (await targets(19581)).map(t => t.id)
  await main(`globalThis.__mouseWindow=new (__mouseRequire('electron').BrowserWindow)({width:1280,height:800,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,sandbox:true}});__mouseWindow.loadFile(${rendererFile ? JSON.stringify(path.resolve(rendererFile)) : "process.resourcesPath+'/app.asar/out/renderer/index.html'"})`)
  let windows
  await until(async () => { windows = (await targets(19581)).find(t => t.type === 'page' && !ids.includes(t.id)); return !!windows }, 'Windows renderer')
  await testPlatform('win32', windows)
  }
  fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify({ work, results }, null, 2))
  console.log('MOUSE_QA_RESULT', path.join(work, 'results.json'))
  if (results.some(r => !r.passed)) process.exitCode = 1
} finally {
  sockets.forEach(s => s.close()); child.kill('SIGTERM'); await pause(500); fs.closeSync(log)
}
