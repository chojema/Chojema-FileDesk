export const isRemotePath = (p: string): boolean => /^(ftp|ftps|sftp):\/\//i.test(p)

export function remotePath(p: string): { key: string; path: string; url: URL } {
  const url = new URL(p)
  if (!isRemotePath(p) || url.password || url.search || url.hash) throw new Error('Invalid remote path')
  const name = decodeURIComponent(url.pathname || '/')
  if (/[\r\n\0]/.test(name)) throw new Error('Invalid remote path')
  return { key: `${url.protocol}//${url.username}@${url.host}`, path: name, url }
}

export function remoteUrl(base: string, pathname: string): string {
  const { url } = remotePath(base)
  url.pathname = pathname.split('/').map(encodeURIComponent).join('/')
  return url.href
}

export function remoteName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !/[\/\\\r\n\0]/.test(name)
}
