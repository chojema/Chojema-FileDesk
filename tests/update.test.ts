import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { checkedDownload, newer, selectUpdate } from '../src/main/update-core'
import type { Release } from '../src/main/update-core'

const artifact = (name: string) => ({ name, size: 200, browser_download_url: `https://github.com/chojema/Chojema-FileDesk/releases/download/v0.2.0/${name}` })
const release: Release = { tag_name: 'v0.2.0', html_url: 'https://github.com/chojema/Chojema-FileDesk/releases/tag/v0.2.0', body: 'Release notes', draft: false, prerelease: false,
  assets: ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64-setup.exe', 'win-arm64-setup.exe', 'win-x64-portable.exe'].map(s => artifact(`Chojema-FileDesk-0.2.0-${s}`)) }
test('versions compare numerically and never downgrade or accept prerelease tags', () => {
  assert.equal(newer('v0.10.0','0.2.0'),true); assert.equal(newer('0.2.0','0.2.0'),false)
  assert.equal(newer('0.1.0','0.2.0'),false); assert.equal(newer('0.3.0-beta','0.2.0'),false)
  assert.throws(() => selectUpdate({...release, prerelease:true},'0.1.0','darwin','arm64'))
})
test('matches the OS, architecture and portable channel without falling back to another CPU', () => {
  for (const [platform,arch,suffix,portable] of [['darwin','arm64','mac-arm64.dmg',false],['darwin','x64','mac-x64.dmg',false],['win32','arm64','win-arm64-setup.exe',false],['win32','x64','win-x64-portable.exe',true]] as const) {
    const result=selectUpdate(release,'0.1.0',platform,arch,portable)
    assert.ok(result.asset?.name.endsWith(suffix)); assert.equal(result.info.available,true)
  }
  assert.equal(selectUpdate(release,'0.1.0','win32','ia32').asset,undefined)
  assert.equal(selectUpdate(release,'0.3.0','darwin','arm64').info.available,false)
})
test('rejects a release pointing outside the exact repository asset URL', () => {
  const bad=structuredClone(release);bad.assets[0].browser_download_url='https://example.com/update.dmg'
  assert.throws(()=>selectUpdate(bad,'0.1.0','darwin','arm64'))
})
test('verified download rejects truncation, tampering and oversized content, and preserves existing files', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'filedesk-update-test-'))
  const content=Buffer.from('verified update bytes');const hash=createHash('sha256').update(content).digest('hex')
  try {
    const target=path.join(dir,'update.dmg');let last=0
    await checkedDownload(new Response(content),target,content.length,hash,p=>{last=p.received})
    assert.deepEqual(await fs.readFile(target),content);assert.equal(last,content.length)
    await assert.rejects(checkedDownload(new Response('bad'),target,3,hash,()=>{}))
    assert.deepEqual(await fs.readFile(target),content)
    for(const [name,data,size] of [['corrupt','tampered bytes',14],['short','short',50],['long','too long',2]] as const){
      const file=path.join(dir,name)
      await assert.rejects(checkedDownload(new Response(data),file,size,hash,()=>{}))
      await assert.rejects(fs.stat(file))
    }
  } finally { await fs.rm(dir,{recursive:true,force:true}) }
})
