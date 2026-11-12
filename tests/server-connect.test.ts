import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Socket } from 'node:net'
import { RemoteManager } from '../src/main/remote'
import type { ServerProtocol } from '../src/shared/types'

for (const protocol of ['ftp', 'ftps', 'ftps-implicit'] as ServerProtocol[]) {
  test(`${protocol}: SSH greeting gives protocol guidance before login`, { timeout: 4000 }, async () => {
    const sockets = new Set<Socket>(), received: string[] = []
    const server = createServer(socket => {
      sockets.add(socket)
      socket.on('error', () => {})
      socket.on('data', data => received.push(data.toString()))
      socket.write('S')
      setTimeout(() => { if (!socket.destroyed) socket.write('SH-2.0-OpenSSH_8.7\r\n') }, 20)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const remote = new RemoteManager(async () => { throw Error('Unexpected trust prompt') })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await assert.rejects(Promise.race([
        remote.connect({ profile: { id: 'ssh-fixture', name: '', protocol, host: '127.0.0.1', port, username: 'fixture-user', remoteDir: '', privateKeyPath: '', rememberPassword: false }, password: 'fixture-password', passphrase: '', saveProfile: false }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('No protocol guidance within one second')), 1000) })
      ]), (error: Error) => {
        assert.match(error.message, /SFTP.*SSH/)
        assert.equal(error.cause, protocol === 'ftps-implicit' ? 'server.tlsMismatch' : 'server.sftpRequired')
        return true
      })
      assert.equal(received.some(data => /USER fixture-user|PASS fixture-password/.test(data)), false)
      assert.deepEqual(remote.connections(), [])
    } finally {
      clearTimeout(timer)
      await remote.closeAll()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
}

test('FTP greeting containing SSH text still connects and disconnects normally', async () => {
  const sockets = new Set<Socket>(), commands: string[] = []
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.write('220 FTP with SSH-2.0-compatible accounts\r\n')
    let pending = ''
    socket.on('data', data => {
      pending += data.toString()
      const lines = pending.split('\r\n')
      pending = lines.pop()!
      for (const line of lines) {
        commands.push(line)
        const command = line.split(' ')[0]
        const reply = command === 'USER' ? '331 Password required' : command === 'PASS' ? '230 Logged in' : command === 'PWD' ? '257 "/"' : command === 'FEAT' ? '211 No features' : command === 'QUIT' ? '221 Goodbye' : '200 OK'
        socket.write(reply + '\r\n')
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const remote = new RemoteManager(async () => false)
  try {
    const connection = await remote.connect({ profile: { id: 'ftp-fixture', name: '', protocol: 'ftp', host: '127.0.0.1', port, username: 'fixture-user', remoteDir: '', privateKeyPath: '', rememberPassword: false }, password: 'fixture-password', passphrase: '', saveProfile: false })
    assert.equal(remote.connections().length, 1)
    assert.ok(commands.includes('USER fixture-user'))
    assert.ok(commands.includes('PASS fixture-password'))
    await remote.disconnect(connection.root)
    assert.deepEqual(remote.connections(), [])
  } finally {
    await remote.closeAll()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
