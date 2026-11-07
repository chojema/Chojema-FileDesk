<p align="center"><img src="resources/icon-256.png" width="96" height="96" alt="Chojema FileDesk"></p>
<h1 align="center">Chojema FileDesk</h1>
<p align="center">Windows, macOS용 2패널 파일 관리자</p>
<p align="center"><b>한국어</b> | <a href="README.en.md">English</a></p>

## 설치

[최신 버전 다운로드](https://github.com/chojema/Chojema-FileDesk/releases/latest)

| 운영체제 | 파일 |
| --- | --- |
| Windows 설치형(x64, ARM64 자동 선택) | `*-win-setup.exe` |
| Windows 포터블(x64) | `*-win-x64-portable.exe` |
| macOS Apple Silicon | `*-mac-arm64.dmg` |
| macOS Intel | `*-mac-x64.dmg` |

macOS는 DMG의 앱을 Applications 폴더로 복사합니다. 처음 실행이 차단되면 Windows는 **추가 정보 → 실행**, macOS는 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 선택하세요.

## 주요 조작

| 키 | 동작 |
| --- | --- |
| `Tab` | 패널 전환 |
| `Enter` | 폴더나 파일 열기 |
| `Space` / `Insert` | 선택 토글 |
| `F2` | 이름 변경 |
| `F5` / `F6` | 반대쪽 패널로 복사 / 이동 |
| `F7` | 새 폴더 |
| `F8` / `Delete` | 삭제 |
| `Ctrl/⌘+L` | 경로 입력 |
| `Ctrl/⌘+K` | 서버 연결 |
| `Ctrl/⌘+U` | 좌우 패널 교환 |
| `Ctrl/⌘+.` | 숨김 항목 표시 전환 |
| `F10` | 설정 |

macOS에서 펑션 키가 동작하지 않으면 `fn`을 함께 누르세요. 하단 기능 키 표시줄은 설정에서 끌 수 있습니다.

## 마우스

파일 목록에서 오른쪽 버튼을 누르면 Windows는 탐색기 메뉴, macOS는 Finder와 같은 메뉴가 열립니다. 파일과 폴더는 반대쪽 패널이나 다른 앱으로 끌어다 놓을 수 있고, 다른 앱의 항목을 패널이나 폴더 위로 끌어오면 복사됩니다. 이동하려면 Windows는 `Shift`, macOS는 `⌘`를 누른 채 놓으세요. 서버 파일은 반대쪽 패널로만 끌어다 놓을 수 있습니다.

## 서버 연결

**서버 → 서버에 연결**에서 호스트, 포트, 계정을 입력합니다. `sftp://user@host:22/folder` 형식의 주소도 사용할 수 있습니다. 연결한 패널과 로컬 패널 사이에서 `F5`로 업로드하거나 다운로드합니다.

| 프로토콜 | 기본 포트 | 인증 |
| --- | --- | --- |
| FTP | 21 | 계정과 암호 또는 anonymous. 암호화되지 않습니다. |
| FTPS | 21(명시적 TLS), 990(암시적 TLS) | 계정과 암호 |
| SFTP | 22 | SSH 암호 또는 OpenSSH/PEM 개인 키 |

FTP/FTPS 서버는 Passive 모드의 데이터 포트도 허용해야 합니다.

**서버 파일은 영구 삭제됩니다.** 원격 파일을 열어 수정했다면 다시 업로드해야 합니다. 중단된 전송의 이어받기는 지원하지 않습니다.

## 업데이트

**정보 → 업데이트 확인**에서 설치 파일을 받아 열면 앱이 자동으로 종료됩니다. Windows는 설치를 완료하고, macOS는 새 앱을 Applications 폴더로 복사하세요. 포터블은 새 실행 파일이 기존 파일과 같은 폴더에 저장됩니다. 시작 시 자동 확인은 설정에서 켤 수 있습니다.

## 데이터

설정과 접속 정보는 이 컴퓨터에 저장됩니다. 암호 저장은 선택 사항이며 운영체제 기능으로 암호화합니다. 사용 통계는 수집하지 않습니다.

[MIT 라이선스](LICENSE) | © 2026 Chulwoo Park
