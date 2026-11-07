import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fitWindow, readWindowState, writeWindowState } from '../src/main/window-state'
const primary={x:0,y:25,width:1440,height:875}
test('new/reset window uses a centered default that fits the work area',()=>{
 assert.deepEqual(fitWindow(undefined,[primary],primary),{x:80,y:63,width:1280,height:800,maximized:false})
 const small={x:0,y:0,width:640,height:400}
 assert.deepEqual(fitWindow(undefined,[small],small),{x:0,y:0,width:640,height:400,maximized:false})
})
test('restores normal bounds and maximized status on the same screen',()=>{
 const state={x:150,y:95,width:980,height:650,maximized:true}
 assert.deepEqual(fitWindow(state,[primary],primary),state)
})
test('supports displays to the left and preserves negative coordinates',()=>{
 const secondary={x:-1920,y:0,width:1920,height:1080}
 const state={x:-1800,y:100,width:1200,height:700,maximized:false}
 assert.deepEqual(fitWindow(state,[primary,secondary],primary),state)
})
test('removed monitor positions recenter on the primary display',()=>{
 const state={x:2500,y:150,width:1000,height:600,maximized:false}
 assert.deepEqual(fitWindow(state,[primary],primary),{x:220,y:163,width:1000,height:600,maximized:false})
})
test('partially visible and oversized windows are kept fully on screen',()=>{
 assert.deepEqual(fitWindow({x:-50,y:-100,width:2000,height:1500},[primary],primary),{x:0,y:25,width:1440,height:875,maximized:false})
 const invalid={x:NaN,y:1,width:900,height:700}
 assert.deepEqual(fitWindow(invalid,[primary],primary),fitWindow(undefined,[primary],primary))
})
test('window state survives atomic save, tolerates missing/corrupt data',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'filedesk-window-test-')),file=path.join(dir,'window-state.json')
 try{
  assert.equal(readWindowState(file),undefined)
  const state={x:100,y:200,width:900,height:600,maximized:false}
  writeWindowState(file,state);assert.deepEqual(readWindowState(file),state)
  await fs.writeFile(file,'broken');assert.equal(readWindowState(file),undefined)
 }finally{await fs.rm(dir,{recursive:true,force:true})}
})
