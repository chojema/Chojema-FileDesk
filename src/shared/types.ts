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

export interface ColumnWidths {
  ext: number
  size: number
  mtime: number
}

export type PlaceShortcut = 'home' | 'desktop' | 'documents' | 'downloads'
export type PlaceVisibility = Record<PlaceShortcut, boolean>

export interface Settings {
  lang: Lang
  theme: ThemePref
  showHidden: boolean
  showDotFiles: boolean
  confirmDelete: boolean
  checkUpdatesOnStart: boolean
  windowStart: 'restore' | 'reset'
  showFkeys: boolean
  /** Optional shortcuts in the drive bar; drives and connected servers remain visible. */
  visiblePlaces: PlaceVisibility
  /** File list column widths in px, shared by both panes; the name column takes the rest. */
  columns: ColumnWidths
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
  /** Language of copy names when copying into the source folder (set by the main process). */
  lang?: Lang
}

export interface TransferResult {
  done: number
  skipped: number
  errors: { path: string; message: string }[]
  /** Copies made in the source folder under a new name. */
  created?: string[]
}

export interface FileClipboard { paths: string[]; cut: boolean }

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

export interface ContextItem {
  id?: string
  label?: string
  accelerator?: string
  enabled?: boolean
  type?: 'separator'
}

export interface ShellMenuRequest {
  /** Items the menu acts on; empty for the folder background. */
  paths: string[]
  folder: string
  /** Complete app menu, used where no system menu is available (server folders). */
  items: ContextItem[]
  /** App commands added to the Explorer/Finder menu. */
  extras: ContextItem[]
  /** Shift+right-click: Windows extended verbs. */
  extended?: boolean
  /** The selected item is a shortcut or drive in the places bar. */
  place?: boolean
}

export interface ShellMenuResult {
  /** App command to run. */
  id?: string
  /** Files for the paste command. */
  paths?: string[]
  /** A system command may have changed the folder. */
  changed?: boolean
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
  /** Files on the OS clipboard (Explorer/Finder format); cut is set by Explorer's Cut. */
  readFileClipboard(): Promise<FileClipboard>
  /** Puts local files on the OS clipboard; an empty list clears it. */
  writeFileClipboard(paths: string[], cut: boolean): Promise<void>
  /** A drive or volume was added or removed. */
  onPlacesChanged(cb: () => void): () => void
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
  /** Local path of a file dropped from the OS, or '' when it has none. */
  pathForFile(file: File): string
  /** Starts a native drag of local files out of the window. */
  startDrag(paths: string[]): void
  /** Shows a native context menu and resolves with the chosen item id. */
  contextMenu(req: ShellMenuRequest): Promise<ShellMenuResult>
  onAppError(cb: (message: string) => void): () => void
  /** System file-type icon as a data URL ('' when unavailable). */
  fileIcon(path: string): Promise<string>
}
