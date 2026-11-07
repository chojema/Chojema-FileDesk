import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRemotePath, remoteName, remotePath, remoteUrl } from '../src/shared/remote-path'
import { normalizeProfile } from '../src/main/remote'
import type { ServerProfile } from '../src/shared/types'
const profile:ServerProfile={id:'fixture',name:'test',protocol:'sftp',host:'[::1]',port:22,username:'user',remoteDir:'/',privateKeyPath:'',rememberPassword:false}
test('remote paths preserve case, Unicode, spaces, percent and URL delimiters without exposing passwords',()=>{
  const base='sftp://user@localhost:22/'
  const p=remoteUrl(base,'/한글 & x/100% #name?.txt')
  assert.equal(remotePath(p).path,'/한글 & x/100% #name?.txt')
  assert.equal(remotePath(p).key,remotePath(base).key)
  assert.ok(isRemotePath(p));assert.equal(isRemotePath('/tmp/a'),false)
  assert.throws(()=>remotePath('ftp://user:secret@host/path'))
  assert.throws(()=>remotePath('sftp://host/a%0d%0ab'))
  for(const n of ['..','a/b','a\\b','a\r\nb',''])assert.equal(remoteName(n),false)
})
test('connection validation handles IPv6, anonymous FTP and invalid ports/control characters',()=>{
  assert.equal(normalizeProfile(profile).host,'::1')
  assert.equal(normalizeProfile({...profile,protocol:'ftp',username:''}).username,'anonymous')
  assert.throws(()=>normalizeProfile({...profile,port:0}))
  assert.throws(()=>normalizeProfile({...profile,host:'user@host'}))
  assert.throws(()=>normalizeProfile({...profile,username:'a\nUSER x'}))
})
