<p align="center">
  <img src="resources/icon-256.png" width="128" height="128" alt="Chojema FileDesk icon">
</p>

<h1 align="center">Chojema FileDesk</h1>

<p align="center">A dual-pane file manager for Windows and macOS</p>

<p align="center"><a href="README.md">한국어</a> · <b>English</b></p>

---

## About

Chojema FileDesk is a two-pane file manager. Browse folders with the keyboard and copy or move files from one pane to the other.

## Features

- Side-by-side panes; drag an empty area of the center toolbar to resize (double-click to reset)
- Vertical toolbar between the panes: parent folder, go to top, new folder, copy to other pane, move to other pane, move to Trash, go to bottom, and (at the very bottom) open a terminal in the current folder, and copy the path of selected items, and copy the file/folder list of the active pane
- Quick access to drives, volumes, Home, Desktop, Documents and Downloads
- Sort by name, extension, size or modification date
- Keyboard-first workflow with a function-key bar and type-ahead search
- Copy, move, new folder, rename and move to Trash
- Overwrite All / Skip All when names collide
- Folder size calculation when a folder is selected
- Back/forward history and direct path entry
- Visited folders (last 30) and favorite folders from the path bar
- Show/hide hidden items, with separate options for hidden-attribute items and items starting with a dot (eye icon in the path bar, `Ctrl/⌘` + `.`, View menu, Settings)
- FTP, FTPS and SFTP connections, saved servers and file/folder uploads/downloads
- GitHub release checks and verified update downloads
- Korean and English interface
- Light, dark or system theme

## Center toolbar

The vertical toolbar between the panes acts on the active pane (the one with the highlighted border).

| Button | Action | Same as |
| --- | --- | --- |
| Parent Folder | Go up one folder | `Backspace` (macOS: `⌘` + `↑`) |
| Go to Top | Move to the first item | `Home` |
| New Folder | Create a folder in the current folder | `F7` |
| Copy | Copy selected items to the other pane's folder | `F5` |
| Move | Move selected items to the other pane's folder | `F6` |
| Delete | Move selected items to the Trash | `F8` |
| Go to Bottom | Move to the last item | `End` |
| Terminal (bottom of the toolbar) | Open a terminal in the active pane's current folder: Windows Terminal (or Command Prompt) on Windows, Terminal on macOS | File menu |
| Copy Path (bottom of the toolbar) | Copy the full path of the selected files/folders to the clipboard, one per line; with no selection, the item under the cursor; on `..`, the current folder | `Ctrl/⌘` + `Shift` + `C` |
| Copy List (bottom of the toolbar) | Copy the names of all files and folders listed in the active pane, one per line in display order; items hidden by the hidden-item settings are left out | File menu |

The copy and move arrows always point from the active pane toward the other pane. With nothing selected, the item under the cursor is used.

## Visited folders and favorites

Two buttons sit at the right of each pane's path bar.

| Button | Action | Shortcut |
| --- | --- | --- |
| Clock (Visited Folders) | The last 30 folders you opened, newest first, shared by both panes. **Clear History** at the bottom empties it. | `Alt` + `↓` (macOS: `⌥` + `↓`) |
| Star (Favorite Folders) | Your favorite folders. The top entry adds or removes the current folder. The star is filled when the current folder is a favorite. | `Ctrl/⌘` + `D` |

In the list, choose with `↑` `↓` and open with `Enter`. Remove an entry with `Delete` or the `×` on its right, and close with `Esc`.

## Hidden items

Under **Hidden items** in Settings (`F10`) you can switch two kinds of items on and off separately.

| Setting | Applies to |
| --- | --- |
| Show files and folders with the hidden attribute | Items with the hidden attribute on Windows, or the hidden flag on macOS (e.g. `~/Library`) |
| Show files and folders starting with a dot (.) | Items such as `.git`, `.env`, `.DS_Store` |

The eye icon at the right of the path bar, or `Ctrl/⌘` + `.`, turns both on or off at once. The View menu toggles each one. The number of hidden items appears in the pane's status bar.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Tab` | Switch pane |
| `Ctrl/⌘` + `K` | Connect to server |
| `Enter` | Open folder / open file with its default app |
| `Backspace` | Parent folder |
| `Space` | Toggle selection |
| `Insert` | Toggle selection and move down |
| `Shift` + arrows | Range selection |
| `Ctrl/⌘` + `A` | Select all |
| `F2` | Rename |
| `F3` | Open |
| `F5` | Copy to other pane |
| `F6` | Move to other pane |
| `F7` | New folder |
| `F8` / `Delete` / `⌘` + `Backspace` | Move to Trash |
| `F10` / `Ctrl/⌘` + `,` | Settings |
| `Ctrl/⌘` + `R` | Refresh |
| `Ctrl/⌘` + `L` | Edit path |
| `Alt` + `↓` | Visited folders |
| `Ctrl/⌘` + `D` | Favorite folders |
| `Ctrl/⌘` + `Shift` + `C` | Copy path of selected items |
| `Ctrl/⌘` + `.` | Show / hide all hidden items |
| `Ctrl/⌘` + `U` | Swap panes |
| `Ctrl/⌘` + `=` | Same folder in other pane |
| `Alt` + `←/→` (macOS: `⌘` + `[` / `]`) | Back / forward |

On macOS, hold `fn` for function keys or click the function-key bar at the bottom of the window.

## Installation

Download the file for your system from the [Releases](../../releases) page.

| System | File |
| --- | --- |
| Windows (automatic x64/ARM64 selection) | `Chojema-FileDesk-<version>-win-setup.exe` |
| Windows (installer) | `Chojema-FileDesk-<version>-win-x64-setup.exe` (`arm64` for ARM PCs) |
| Windows (portable) | `Chojema-FileDesk-<version>-win-x64-portable.exe` |
| macOS (Apple Silicon) | `Chojema-FileDesk-<version>-mac-arm64.dmg` |
| macOS (Intel) | `Chojema-FileDesk-<version>-mac-x64.dmg` |

### First launch

The app is not signed with a commercial code-signing certificate, so you may see a warning the first time.

- **Windows**: when "Windows protected your PC" appears, click **More info** → **Run anyway**.
- **macOS**: if the app is blocked, open **System Settings** → **Privacy & Security** and click **Open Anyway**.

## Updates

Choose **Information → Check for Updates**, or use the button above the panes. If a newer release is available, review its notes and choose **Download and Open Installer**. FileDesk selects the matching OS/CPU artifact and verifies its SHA-256 checksum before opening it.

- Windows: quit FileDesk and complete the installer. For a portable installation, replace the old executable with the new one.
- macOS: quit FileDesk, then copy the app from the opened DMG into Applications to replace the old app.
- Enable **Settings → Check for updates on startup** to receive update notices at launch. Installation remains your choice.

## File server connections and transfers

1. Choose **Server → Connect to Server** (`Ctrl/⌘+K`), or use **Connect to Server** above the panes.
2. Enter the protocol, hostname, port, username and password. You can also paste a URL such as `sftp://user@server:22/folder`.
3. Select a pane and connect. The right pane is selected by default. Open your local folder in the other pane.
4. Select files/folders and press **F5 Copy** to upload or download. **F6 Move** removes a source only after its complete transfer succeeds. Choose overwrite or skip when names conflict.

| Protocol | Default port | Authentication |
| --- | --- | --- |
| FTP | 21 | Plain, unencrypted FTP. Leave the username blank for anonymous access. |
| FTPS · TLS | 21 | Explicit TLS (FTPES), when supported by the server. |
| FTPS · Implicit TLS | 990 | Servers requiring implicit TLS. |
| SFTP · SSH | 22 | SSH password or an OpenSSH/PEM private key with an optional passphrase. |

FTP/FTPS use passive mode, binary transfers and UTF-8 filenames. A NAS/firewall must allow the control port and the server's configured passive data-port range. FTPS also encrypts its data connections.

- Leave the initial remote folder blank to use the server's login directory.
- **Save connection profile** keeps frequently used servers. **Remember password** is optional and stores credentials using OS encryption on this computer. Private keys are read from the file you choose.
- FileDesk asks you to verify first-use SSH keys and FTPS certificates that cannot be validated through public trust. Compare the fingerprint with your server administrator's value. Changed saved fingerprints require confirmation again.
- Connected servers appear in each pane's places bar. **Disconnect Server** returns panes using that connection to local folders. Reconnect using a saved profile after restarting the app.
- Create folders, rename items and calculate folder sizes on the server. **Remote deletion is permanent and always requires confirmation; remote items do not go to Trash.**
- Opening a remote file downloads a temporary local copy. Upload it again to send your edits to the server. Transfers involving a server do not follow symbolic links.
- Interrupted transfers keep the source. Check the connection and retry. Resuming from a partial download is not supported.

## Information and websites

The **Information** menu and **About Chojema FileDesk** window include this repository, [Chojema App Park](https://chojema.github.io/AppPark/), [Blog](https://cantips.com), [YouTube](https://www.youtube.com/@cantips), [X](https://twitter.com/chojema), [Instagram](https://www.instagram.com/chojema), [GitHub](https://github.com/chojema), and [Homepage](http://ilovemis.com/).

## Privacy

- FileDesk does not collect usage statistics or personal files. Update checks contact GitHub; server operations contact the server you specify. Information links open in your default browser.
- Settings, visited folders and favorites are stored in `settings.json`; server profiles, trusted fingerprints and encrypted credentials are stored in `servers.json`, only on this computer. Clear history and remove saved servers from within the app.
  - Windows: `%APPDATA%\Chojema FileDesk\`
  - macOS: `~/Library/Application Support/Chojema FileDesk/`
- Local deletion moves items to the OS Trash. Remote deletion is permanent.

## License

[MIT](LICENSE) © 2026 Chulwoo Park
