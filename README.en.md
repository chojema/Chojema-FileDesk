<p align="center"><img src="resources/icon-256.png" width="96" height="96" alt="Chojema FileDesk"></p>
<h1 align="center">Chojema FileDesk</h1>
<p align="center">A two-pane file manager for Windows and macOS</p>
<p align="center"><a href="README.md">한국어</a> | <b>English</b></p>

## Install

[Download the latest version](https://github.com/chojema/Chojema-FileDesk/releases/latest)

| System | File |
| --- | --- |
| Windows installer (automatic x64/ARM64 selection) | `*-win-setup.exe` |
| Windows portable (x64) | `*-win-x64-portable.exe` |
| macOS Apple Silicon | `*-mac-arm64.dmg` |
| macOS Intel | `*-mac-x64.dmg` |

On macOS, copy the app from the DMG to Applications. If the first launch is blocked, choose **More info → Run anyway** on Windows, or **System Settings → Privacy & Security → Open Anyway** on macOS.

## Controls

| Key | Action |
| --- | --- |
| `Tab` | Switch pane |
| `Enter` | Open folder or file |
| `Space` / `Insert` | Toggle selection |
| `F2` | Rename (or click a selected name again, slowly) |
| `F5` / `F6` | Copy / move to the other pane |
| `Ctrl/⌘+C` / `Ctrl/⌘+V` | Copy / paste files (`Ctrl+X` cuts on Windows, `⌘+⌥+V` moves on macOS) |
| `Ctrl/⌘+D` | Duplicate in place |
| `F7` | New folder |
| `F8` / `Delete` | Delete |
| `Ctrl/⌘+L` | Enter path |
| `Ctrl/⌘+K` | Connect to server |
| `Ctrl/⌘+U` | Swap panes |
| `Ctrl/⌘+.` | Toggle hidden items |
| `F10` | Settings |

On macOS, hold `fn` if function keys do not respond. The function key bar can be turned off in Settings.

## Mouse

Right-click the file list for the Explorer menu on Windows or a Finder-style menu on macOS. Drag files and folders to the other pane or to another app; items dragged in from another app onto a pane or folder are copied. Hold `Shift` on Windows or `⌘` on macOS while dropping to move instead. Server files can only be dragged to the other pane.

## Servers

Choose **Server → Connect to Server** and enter the host, port and credentials. URLs such as `sftp://user@host:22/folder` are also accepted. Press `F5` to upload or download between the server and local panes.

| Protocol | Default port | Authentication |
| --- | --- | --- |
| FTP | 21 | Username/password or anonymous; unencrypted. |
| FTPS | 21 (explicit TLS), 990 (implicit TLS) | Username/password |
| SFTP | 22 | SSH password or OpenSSH/PEM private key |

FTP/FTPS servers must also allow their passive data ports.

**Server files are deleted permanently.** Upload an edited remote-file download again to save changes to the server. Interrupted transfers cannot be resumed.

## Updates

Use **Information → Check for Updates** to download and open an installer; FileDesk then quits automatically. Complete installation on Windows; on macOS, copy the new app to Applications. The portable version saves the new executable next to the current one. Startup checks can be enabled in Settings.

## Data

Settings and server profiles are stored on your computer. Password storage is optional and uses OS encryption. No usage statistics are collected.

[MIT License](LICENSE) | © 2026 Chulwoo Park
