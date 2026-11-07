<p align="center"><img src="resources/icon-256.png" width="96" height="96" alt="Chojema FileDesk"></p>
<h1 align="center">Chojema FileDesk</h1>
<p align="center">A two-pane file manager for Windows and macOS</p>
<p align="center"><a href="README.md">한국어</a> · <b>English</b></p>

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
| `F2` | Rename |
| `F5` / `F6` | Copy / move to the other pane |
| `F7` | New folder |
| `F8` / `Delete` | Delete |
| `Ctrl/⌘+L` | Enter path |
| `Ctrl/⌘+K` | Connect to server |
| `Ctrl/⌘+U` | Swap panes |
| `Ctrl/⌘+.` | Toggle hidden items |
| `F10` | Settings |

On macOS, hold `fn` if function keys do not respond.

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

Use **Information → Check for Updates** to download an installer. Complete installation on Windows; on macOS, quit the app and replace it with the new version. Startup checks can be enabled in Settings.

## Data

Settings and server profiles stay on this computer. Password storage is optional and uses OS encryption. No usage statistics are collected.

[MIT License](LICENSE) · © 2026 Chulwoo Park
