export type Lang = 'ko' | 'en'
export type ThemePref = 'system' | 'light' | 'dark'
export type ConflictPolicy = 'overwrite' | 'skip'
export type PaneSide = 'left' | 'right'
export type SortKey = 'name' | 'ext' | 'size' | 'mtime'

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number
  mtime: number
  ext: string
  /** Name starts with a dot. */
  dot: boolean
  /** OS hidden attribute (Windows hidden/system, macOS UF_HIDDEN). */
  hidden: boolean
}

export interface DirListing {
  path: string
  parent: string | null
  entries: FileEntry[]
}

export interface Place {
  id: string
  label: string
  path: string
  kind: 'drive' | 'volume' | 'home' | 'folder' | 'server'
}

export interface DiskSpace {
  free: number
  total: number
}

export interface PaneState {
  path: string
  sortKey: SortKey
  sortAsc: boolean
}

export interface Settings {
  lang: Lang
  theme: ThemePref
  showHidden: boolean
  showDotFiles: boolean
  confirmDelete: boolean
  checkUpdatesOnStart: boolean
  windowStart: 'restore' | 'reset'
  /** Most recently visited folders, newest first (local only). */
  recentDirs: string[]
  favorites: string[]
  panes: Record<PaneSide, PaneState>
}

export interface TransferRequest {
  op: 'copy' | 'move'
  sources: string[]
  destDir: string
  policy: ConflictPolicy
}

export interface TransferResult {
  done: number
  skipped: number
  errors: { path: string; message: string }[]
}

export interface Progress {
  current: string
  index: number
  total: number
  bytes?: number
}

export type ServerProtocol = 'ftp' | 'ftps' | 'ftps-implicit' | 'sftp'
export interface ServerProfile {
  id: string
  name: string
  protocol: ServerProtocol
  host: string
  port: number
  username: string
  remoteDir: string
  privateKeyPath: string
  rememberPassword: boolean
  hasPassword?: boolean
}
export interface ConnectRequest {
  profile: ServerProfile
  password: string
  passphrase: string
  saveProfile: boolean
}
export interface ServerConnection { id: string; name: string; root: string }
export interface UpdateInfo {
  available: boolean
  current: string
  latest: string
  notes: string
  url: string
  assetName?: string
  size?: number
}
export interface UpdateProgress { received: number; total: number }

export interface Result<T> {
  ok: boolean
  value?: T
  error?: string
}

export interface FileDeskApi {
  platform: NodeJS.Platform
  getVersion(): Promise<string>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  listDir(path: string): Promise<Result<DirListing>>
  places(): Promise<Place[]>
  diskSpace(path: string): Promise<DiskSpace | null>
  resolvePath(input: string, base: string): Promise<Result<string>>
  findConflicts(sources: string[], destDir: string): Promise<string[]>
  transfer(req: TransferRequest): Promise<TransferResult>
  mkdir(parent: string, name: string): Promise<Result<string>>
  rename(path: string, newName: string): Promise<Result<string>>
  trash(paths: string[]): Promise<TransferResult>
  openPath(path: string): Promise<Result<void>>
  revealInOs(path: string): Promise<void>
  openTerminal(path: string): Promise<Result<void>>
  writeClipboard(text: string): Promise<void>
  dirSize(path: string): Promise<number>
  onProgress(cb: (p: Progress) => void): () => void
  onMenu(cb: (cmd: string) => void): () => void
  setMenuLang(lang: Lang): Promise<void>
  openLink(url: string): Promise<void>
  checkUpdate(): Promise<Result<UpdateInfo>>
  downloadUpdate(): Promise<Result<string>>
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void
  serverProfiles(): Promise<ServerProfile[]>
  removeServerProfile(id: string): Promise<void>
  connectServer(req: ConnectRequest): Promise<Result<ServerConnection>>
  disconnectServer(root: string): Promise<void>
  serverConnections(): Promise<ServerConnection[]>
  pickPrivateKey(): Promise<string | null>
}
