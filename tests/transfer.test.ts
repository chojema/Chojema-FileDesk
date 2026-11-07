import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { RemoteManager } from '../src/main/remote'
import { FileService, joinItem } from '../src/main/file-service'
import type * as Local from '../src/main/fsops'
import type { ServerProtocol } from '../src/shared/types'

const python=process.env.FILEDESK_TEST_PYTHON
for(const protocol of ['ftp','ftps','ftps-implicit','sftp'] as ServerProtocol[]){
  test(`${protocol}: real connect/list, upload/download/move, Unicode, skip/overwrite, rename/delete, disconnect and trust rejection`,{skip:!python,timeout:45000},async()=>{
    const work=await fs.mkdtemp(path.join(os.tmpdir(),'filedesk-network-test-'))
    const server=path.join(work,'server'),local=path.join(work,'local'),download=path.join(work,'downloads')
    await Promise.all([server,local,download].map(p=>fs.mkdir(p)))
    const cert=path.join(work,'server.pem')
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',cert,'-out',path.join(work,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'})
    await fs.appendFile(cert,await fs.readFile(path.join(work,'cert.pem')))
    const privateKey=path.join(work,'id_ed25519')
    if(protocol==='sftp')execFileSync('ssh-keygen',['-q','-t','ed25519','-f',privateKey,'-N','fixture-phrase'],{stdio:'ignore'})
    const child=spawn(python!,['tests/fixtures/server.py',protocol,server,cert],{stdio:['ignore','pipe','pipe'],env:{...process.env,FILEDESK_TEST_KEY:privateKey}})
    let output='';child.stderr.on('data',d=>{output+=d})
    const lines=createInterface({input:child.stdout})
    const port=await new Promise<number>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error(`Fixture did not start: ${output}`)),10000)
      lines.once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line).port)})
      child.once('exit',code=>{clearTimeout(timer);reject(Error(`Fixture exited ${code}: ${output}`))})
    })
    let trusts=0
    const remote=new RemoteManager(async(_host,fp,kind)=>{trusts++;assert.ok(fp.startsWith('SHA256:'));assert.ok(kind==='TLS'||kind==='SSH');return true})
    const localApi={listDir: async(p:string)=>({ok:true,value:{path:p,parent:path.dirname(p),entries:await Promise.all((await fs.readdir(p)).map(async name=>{const full=path.join(p,name),s=await fs.lstat(full);return {name,path:full,isDir:s.isDirectory(),isSymlink:s.isSymbolicLink(),size:s.size,mtime:s.mtimeMs,ext:path.extname(name).slice(1),hidden:false,dot:name.startsWith('.')}}))}})} as typeof Local
    const files=new FileService(localApi,remote)
    const request={profile:{id:'test',name:'fixture',protocol,host:'127.0.0.1',port,username:'filedesk-test',remoteDir:'/',privateKeyPath:'',rememberPassword:false},password:'fixture-only',passphrase:'',saveProfile:false}
    try {
      const con=await remote.connect(request);assert.equal(remote.connections().length,1)
      const root=con.root
      if(protocol!=='ftp')assert.ok(trusts>0)
      const source=path.join(local,'한글 & 100% #?.txt');const bytes=Buffer.alloc(512*1024,0x6b)
      await fs.writeFile(source,bytes)
      let progress=0
      let result=await files.transfer({op:'copy',sources:[source],destDir:root,policy:'overwrite'},p=>{progress=Math.max(progress,p.bytes||0)})
      assert.deepEqual(result.errors,[]);assert.equal(result.done,1);assert.ok(progress>0)
      assert.deepEqual(await fs.readFile(path.join(server,path.basename(source))),bytes)
      const item=joinItem(root,path.basename(source))
      assert.equal((await files.list(root)).value?.entries[0].name,path.basename(source))
      assert.deepEqual(await files.conflicts([source],root),[path.basename(source)])
      result=await files.transfer({op:'copy',sources:[source],destDir:root,policy:'skip'},()=>{});assert.equal(result.skipped,1)
      await fs.writeFile(source,'replaced')
      result=await files.transfer({op:'copy',sources:[source],destDir:root,policy:'overwrite'},()=>{});assert.equal(result.done,1);assert.deepEqual(result.errors,[])
      assert.equal(await fs.readFile(path.join(server,path.basename(source)),'utf8'),'replaced')
      result=await files.transfer({op:'copy',sources:[item],destDir:download,policy:'overwrite'},()=>{});assert.equal(result.done,1);assert.equal(await fs.readFile(path.join(download,path.basename(source)),'utf8'),'replaced')
      const made=await files.mkdir(root,'folder');assert.equal(made.ok,true)
      const nested=path.join(local,'nested');await fs.mkdir(nested);await fs.writeFile(path.join(nested,'child.txt'),'nested data')
      result=await files.transfer({op:'copy',sources:[nested],destDir:root,policy:'overwrite'},()=>{});assert.equal(result.done,1)
      assert.equal(await files.dirSize(joinItem(root,'nested')),11)
      result=await files.transfer({op:'copy',sources:[joinItem(root,'nested')],destDir:joinItem(root,'nested'),policy:'overwrite'},()=>{});assert.equal(result.errors[0].message,'into-self')
      const renamed=await files.rename(item,'renamed.txt');assert.equal(renamed.ok,true)
      result=await files.transfer({op:'move',sources:[renamed.value!],destDir:made.value!,policy:'overwrite'},()=>{});assert.equal(result.done,1);assert.equal(await remote.stat(renamed.value!),undefined)
      result=await files.transfer({op:'move',sources:[made.value!],destDir:download,policy:'overwrite'},()=>{});assert.equal(result.done,1);assert.equal(await remote.stat(made.value!),undefined)
      assert.equal(await fs.readFile(path.join(download,'folder','renamed.txt'),'utf8'),'replaced')
      result=await files.trash([joinItem(root,'nested')],()=>{});assert.equal(result.done,1)
      assert.deepEqual(await fs.readdir(server),[])
      await assert.rejects(remote.connect({...request,password:'wrong-password'}))
      assert.equal((await files.list(root)).ok,true,'failed reconnect preserves the active connection')
      if(protocol==='sftp'){
        await remote.connect({...request,profile:{...request.profile,privateKeyPath:privateKey},password:'',passphrase:'fixture-phrase'})
        assert.equal((await files.list(root)).ok,true,'encrypted OpenSSH key authentication')
      }
      const link=path.join(local,'link');await fs.symlink(source,link)
      result=await files.transfer({op:'move',sources:[link],destDir:root,policy:'overwrite'},()=>{})
      assert.equal(result.done,0);assert.equal(result.errors.length,1);assert.equal((await fs.lstat(link)).isSymbolicLink(),true)
      const interrupted=path.join(local,'interrupted.bin');await fs.writeFile(interrupted,Buffer.alloc(4*1024*1024,0x55))
      let dropped=false
      result=await files.transfer({op:'move',sources:[interrupted],destDir:root,policy:'overwrite'},p=>{
        if((p.bytes||0)>0&&!dropped){dropped=true;void remote.disconnect(root)}
      })
      assert.equal(dropped,true);assert.equal(result.done,0);assert.equal(result.errors.length,1)
      assert.equal((await fs.stat(interrupted)).size,4*1024*1024,'interrupted move must keep the original')
      await remote.connect(request)
      await remote.disconnect(root);await assert.rejects(remote.list(root),/disconnected/i)
      if(protocol!=='ftp'){
        const untrusted=new RemoteManager(async()=>false)
        await assert.rejects(untrusted.connect(request));await untrusted.closeAll()
      }
    } finally { await remote.closeAll();lines.close();child.kill('SIGTERM');await fs.rm(work,{recursive:true,force:true}) }
  })
}
