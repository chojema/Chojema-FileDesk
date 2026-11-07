"""Loopback-only integration fixture. pip install -r tests/fixtures/requirements.txt."""
import os, sys, json, socket, threading, time, posixpath, errno
from pathlib import Path
mode, root, certificate = sys.argv[1:]
root = Path(root).resolve()
user, password = 'filedesk-test', 'fixture-only'
if mode in ('ftp', 'ftps', 'ftps-implicit'):
    from pyftpdlib.authorizers import DummyAuthorizer
    from pyftpdlib.handlers import FTPHandler, TLS_FTPHandler
    from pyftpdlib.servers import FTPServer
    import logging
    logging.getLogger('pyftpdlib').setLevel(logging.CRITICAL)
    auth = DummyAuthorizer()
    auth.add_user(user, password, str(root), perm='elradfmwMT')
    base = FTPHandler if mode == 'ftp' else TLS_FTPHandler
    class Handler(base):
        def on_connect(self):
            if mode == 'ftps-implicit': self.secure_connection(self.ssl_context)
    Handler.authorizer = auth
    if mode != 'ftp':
        Handler.certfile = certificate
        Handler.tls_data_required = True
        Handler.tls_control_required = True
    server = FTPServer(('127.0.0.1', 0), Handler)
    print(json.dumps({'port': server.socket.getsockname()[1]}), flush=True)
    server.serve_forever(timeout=0.1, handle_exit=False)
else:
    import paramiko
    def local(remote):
        p = (root / remote.lstrip('/')).resolve()
        if p != root and root not in p.parents: raise PermissionError(errno.EACCES, 'outside fixture')
        return p
    def error(e): return paramiko.SFTPServer.convert_errno(e.errno or errno.EIO)
    class Files(paramiko.SFTPServerInterface):
        def canonicalize(self, p): return posixpath.normpath('/' + p.lstrip('/'))
        def list_folder(self, p):
            try:
                out=[]
                for entry in local(p).iterdir():
                    attr=paramiko.SFTPAttributes.from_stat(entry.lstat()); attr.filename=entry.name; out.append(attr)
                return out
            except OSError as e: return error(e)
        def stat(self, p):
            try: return paramiko.SFTPAttributes.from_stat(local(p).stat())
            except OSError as e: return error(e)
        lstat=stat
        def open(self,p,flags,attr):
            try:
                fd=os.open(local(p),flags,attr.st_mode or 0o600)
                mode='r+b' if flags & os.O_RDWR else 'wb' if flags & os.O_WRONLY else 'rb'
                f=os.fdopen(fd,mode); h=paramiko.SFTPHandle(flags)
                if flags & os.O_RDWR: h.readfile=f;h.writefile=f
                elif flags & os.O_WRONLY: h.writefile=f
                else: h.readfile=f
                return h
            except OSError as e: return error(e)
        def mkdir(self,p,attr):
            try: local(p).mkdir(); return paramiko.SFTP_OK
            except OSError as e: return error(e)
        def remove(self,p):
            try: local(p).unlink(); return paramiko.SFTP_OK
            except OSError as e: return error(e)
        def rmdir(self,p):
            try: local(p).rmdir(); return paramiko.SFTP_OK
            except OSError as e: return error(e)
        def rename(self,a,b):
            try: local(a).rename(local(b)); return paramiko.SFTP_OK
            except OSError as e: return error(e)
    class Auth(paramiko.ServerInterface):
        def check_auth_password(self,u,p): return paramiko.AUTH_SUCCESSFUL if u==user and p==password else paramiko.AUTH_FAILED
        def check_auth_publickey(self,u,key):
            p=os.environ.get('FILEDESK_TEST_KEY')
            if not p: return paramiko.AUTH_FAILED
            expected=paramiko.Ed25519Key.from_private_key_file(p,password='fixture-phrase')
            return paramiko.AUTH_SUCCESSFUL if u==user and key==expected else paramiko.AUTH_FAILED
        def get_allowed_auths(self,u): return 'password,publickey'
        def check_channel_request(self,kind,chanid): return paramiko.OPEN_SUCCEEDED if kind=='session' else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
    key=paramiko.RSAKey.generate(2048)
    sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(10)
    print(json.dumps({'port':sock.getsockname()[1]}),flush=True)
    def serve(client):
        transport=paramiko.Transport(client)
        try:
            transport.add_server_key(key)
            transport.set_subsystem_handler('sftp',paramiko.SFTPServer,Files)
            transport.start_server(server=Auth())
            while transport.is_active(): time.sleep(.05)
        except Exception: pass
        finally: transport.close()
    while True:
        client,_=sock.accept();threading.Thread(target=serve,args=(client,),daemon=True).start()
