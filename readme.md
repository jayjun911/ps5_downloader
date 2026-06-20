# PS5 Downloader CLI (`ps5dl`)

`ps5dl`은 Node.js 기반 CLI 도구로, `dlpsgame.com`에서 PS5 게임을 자동으로 다운로드하고, 암호화 여부 판별 및 후처리(평탄화, Bandizip 7z 재압축, 표준 파일명 리네임)를 수행하며, LaunchBox XML(`PS5.xml`)과 동기화하여 미보유 게임을 추적합니다.

---

# English Guide

## Table of Contents
1. [Prerequisites & Preparations](#1-prerequisites--preparations)
2. [Environment Configuration (`.env`)](#2-environment-configuration-env)
3. [Installation](#3-installation)
4. [Command Reference](#4-command-reference)
5. [Download & Post-processing Pipeline](#5-download--post-processing-pipeline)

---

## 1. Prerequisites & Preparations

### LaunchBox Database Export (`PS5.xml`)
1. In **LaunchBox**, export your PS5 library as a Playlist XML file.
2. Rename the file to **`PS5.xml`** and place it at:
   `C:\Code\PS5_Downloader\data\PS5.xml`

### 1fichier API Key
1. Log in to [1fichier.com](https://1fichier.com/) (Premium/Bypass subscription required).
2. Go to your API settings page and copy your **API Key**.
3. Set it as `FICHIER_API_KEY` in the `.env` file.

### Bandizip
Required for re-compression. Must be installed at:
`C:\Program Files\Bandizip\bz.exe`

### Free Download Manager (optional)
Required only when `DOWNLOAD_MANAGER=FDM`. Default path:
`C:\Program Files\Softdeluxe\Free Download Manager\fdm.exe`

---

## 2. Environment Configuration (`.env`)

```env
# 1fichier API Key (keep private)
FICHIER_API_KEY=your_1fichier_api_key_here

# Directory where downloaded files will be saved
DOWNLOAD_DIR=C:\Z

# Cache expiration for web game list (hours)
CACHE_TTL_HOURS=24

# Your PS5 firmware major version (used for backport filtering)
# Sections that require higher firmware than this value are skipped
USER_FIRMWARE=7

# Download manager: leave empty to use built-in streamer, set to FDM for Free Download Manager
DOWNLOAD_MANAGER=

# Number of concurrent connections when using FDM
DOWNLOADER_SESSION=3
```

*Note: `UnRAR.exe` is auto-downloaded and placed in `bin/` on first run — no manual setup needed.*

---

## 3. Installation

```bash
npm install
npm link
```

After linking, use the `ps5dl` command from anywhere.

---

## 4. Command Reference

### `ps5dl list [source]`
List games from different sources. Supports `--name`/`-n` and `--limit`/`-l` filters.

| Source | Description |
|--------|-------------|
| `all` | Combined local + web + download status |
| `local` | Games in `data/PS5.xml` |
| `downloaded` | Games in `data/downloaded.xml` |
| `web` | All games on dlpsgame.com |
| `tbd` | Web games not yet in local or downloaded lists |
| `excluded` | Games excluded from batch downloads |

```bash
ps5dl list tbd
ps5dl list tbd -l 10 -n "Spider-Man"
```

---

### `ps5dl download [title]`
Download a single game or a batch from the TBD list.

```bash
# Single game
ps5dl download "Aeterna Noctis"

# Batch download (first 5 TBD games)
ps5dl download --limit 5

# Override download directory
ps5dl download "Aeterna Noctis" --out "D:\CustomDownloads"

# Download only a specific file type (GAME, DLC, UPDATE, BACKPORT, UNLOCK)
ps5dl download "EA SPORTS FC 26" --type DLC

# Override archive password
ps5dl download "Game Title" --password "custom_password"

# Mark as completed without downloading
ps5dl download "Game Title" --completed
```

---

### `ps5dl urldown <url>`
Download directly from a 1fichier, Datanodes, or Vikingfile URL and run the full post-processing pipeline.

```bash
ps5dl urldown "https://1fichier.com/?abc123"
ps5dl urldown "https://datanodes.to/abc123" --password "DLPSGAME.COM"
```

---

### `ps5dl completed [title]`
Manually manage the completed games database.

```bash
ps5dl completed                          # List all completed
ps5dl completed "Game Title"             # Mark as completed
ps5dl completed "Game Title" --remove    # Remove from completed
```

---

### `ps5dl exclude [title]`
Exclude games from batch downloads.

```bash
ps5dl exclude                            # List all excluded
ps5dl exclude "Game Title"              # Add to exclusion list
ps5dl exclude "Game Title" --remove     # Remove from exclusion list
```

---

### `ps5dl dupe [query]`
Find and mark web games as duplicates of local/completed games.

```bash
ps5dl dupe "Endling"
```

---

### `ps5dl open <title>`
Open the game's download page in your default browser.

```bash
ps5dl open "After The Fall"
```

---

## 5. Download & Post-processing Pipeline

### Region Priority
Sections are tried in this order: **KOR (exFAT) → KOR → USA (exFAT) → EUR (exFAT) → USA → EUR → Other**

### Backport Filtering
For each section, the tool checks the content for `"Works on X.xx and higher"` notes:
- If the required firmware ≤ `USER_FIRMWARE` → compatible, use this section
- If the required firmware > `USER_FIRMWARE` → incompatible, skip to next section
- If no note is found → fall back to region-name heuristic

**Example** (`USER_FIRMWARE=7`):
- Section: `"Works on 9.xx and higher"` → skip
- BackPort section: `"Works on 7.xx and higher"` → selected and downloaded

### Download Flow
1. **Scraper**: Queries dlpsgame.com via WordPress REST API, bypassing Cloudflare Turnstile.
2. **Link Decoder**: Decodes Base64 payloads, resolves `clk.sh` / `downloadgameps3.net` redirects.
3. **Host Selection**: Prefers 1fichier → Datanodes. Falls back to browser-open for other hosts.
4. **Dead Link Retry**: If a link is dead (404), skips that host and retries the same section with the next best host.
5. **Download**:
   - *Built-in*: Streams directly via 1fichier API or Datanodes multi-step flow.
   - *FDM mode* (`DOWNLOAD_MANAGER=FDM`): Resolves direct URL first, then hands off to Free Download Manager CLI and polls until the file is stable.
6. **exFAT failure handling**: If an exFAT section download fails, any partial `.exfat` file is renamed to `.failed` and the game is skipped entirely (no fallback to other sections).

### Post-processing Flow
After successful download:
1. **Metadata**: Extracts `param.json` from the archive to get real `titleName`, `PPSA`, `version`.
2. **Password detection**: Tests archive with no password, then tries `DLPSGAME.COM`, `dlpsgame.com`, and any scraped password.
3. **If encrypted or split**:
   - Extract with UnRAR/7z
   - Flatten folder structure so `eboot.bin` is at the root
   - Delete original archive(s)
   - Recompress with Bandizip: `bz a -r -fmt:7z -l:7 "output.7z"`
4. **If not encrypted**: Rename to `{Title} [PPSA][vXX.XX]{ext}` and keep as-is.
5. **exFAT / raw files**: Compressed into `.7z` via Bandizip.
6. **Registration**: Records the final filename in `data/downloaded.xml`.

### Final File Naming
| Scenario | Result |
|----------|--------|
| Encrypted/split archive | `{Title} [PPSA][ver].7z` |
| Clean archive (no password) | `{Title} [PPSA][ver]{.rar/.zip/.7z}` |
| exFAT raw image | `{Title} [PPSA][ver].7z` |
| DLC, UNLOCK, UPDATE | `{Title} [PPSA][TYPE]{ext}` |
| Failed exFAT download | `original_name.failed` |

---
---

# 한글 가이드 (Korean Guide)

## 목차
1. [사전 준비 작업](#1-사전-준비-작업-1)
2. [환경 변수 설정 (`.env`)](#2-환경-변수-설정-env-1)
3. [설치 방법](#3-설치-방법-1)
4. [명령어 사용법](#4-명령어-사용법-1)
5. [다운로드 및 후처리 프로세스 흐름](#5-다운로드-및-후처리-프로세스-흐름)

---

## 1. 사전 준비 작업

### LaunchBox 라이브러리 내보내기 (`PS5.xml`)
1. **LaunchBox**에서 PS5 게임들을 플레이리스트 XML로 내보내기합니다.
2. 파일명을 **`PS5.xml`**로 변경하여 다음 경로에 저장합니다:
   `C:\Code\PS5_Downloader\data\PS5.xml`

### 1fichier API 키
1. [1fichier.com](https://1fichier.com/)에 로그인합니다 (Premium 또는 Bypass 구독 필요).
2. API 설정 페이지에서 **API Key**를 복사합니다.
3. `.env` 파일의 `FICHIER_API_KEY`에 붙여넣습니다.

### Bandizip
재압축에 사용됩니다. 반드시 아래 경로에 설치되어 있어야 합니다:
`C:\Program Files\Bandizip\bz.exe`

### Free Download Manager (선택 사항)
`DOWNLOAD_MANAGER=FDM` 설정 시에만 필요합니다. 기본 경로:
`C:\Program Files\Softdeluxe\Free Download Manager\fdm.exe`

---

## 2. 환경 변수 설정 (`.env`)

```env
# 1fichier API 키 (외부 노출 금지)
FICHIER_API_KEY=사용자의_1fichier_api_key_입력

# 다운로드 파일 저장 경로
DOWNLOAD_DIR=C:\Z

# 웹 목록 로컬 캐싱 유효 시간 (시간 단위)
CACHE_TTL_HOURS=24

# 현재 PS5 펌웨어 메이저 버전 (백포트 필터링 기준)
# 이 값보다 높은 펌웨어를 요구하는 섹션은 자동으로 skip
USER_FIRMWARE=7

# 다운로드 매니저: 비워두면 내장 스트리머, FDM 시 Free Download Manager 사용
DOWNLOAD_MANAGER=

# FDM 사용 시 파일당 동시 연결 수
DOWNLOADER_SESSION=3
```

*`UnRAR.exe`는 첫 실행 시 `bin/` 폴더에 자동 다운로드·설치됩니다.*

---

## 3. 설치 방법

```bash
npm install
npm link
```

링크 완료 후 어디서나 `ps5dl` 명령어를 사용할 수 있습니다.

---

## 4. 명령어 사용법

### `ps5dl list [source]`
다양한 소스별 게임 목록을 조회합니다. `--name`/`-n`, `--limit`/`-l` 필터 지원.

| Source | 설명 |
|--------|------|
| `all` | 로컬 + 웹 + 다운로드 상태 통합 |
| `local` | `data/PS5.xml` 내 게임 |
| `downloaded` | `data/downloaded.xml` 내 게임 |
| `web` | dlpsgame.com 전체 목록 |
| `tbd` | 로컬·완료 목록에 없는 미다운로드 게임 |
| `excluded` | 배치 다운로드 제외 목록 |

```bash
ps5dl list tbd
ps5dl list tbd -l 10 -n "Spider-Man"
```

---

### `ps5dl download [title]`
단건 또는 배치로 게임을 다운로드합니다.

```bash
# 단건 다운로드
ps5dl download "Aeterna Noctis"

# 배치 다운로드 (TBD 상위 5개)
ps5dl download --limit 5

# 저장 경로 재정의
ps5dl download "Aeterna Noctis" --out "D:\CustomDownloads"

# 특정 파일 타입만 다운로드 (GAME, DLC, UPDATE, BACKPORT, UNLOCK)
ps5dl download "EA SPORTS FC 26" --type DLC

# 아카이브 비밀번호 수동 지정
ps5dl download "Game Title" --password "custom_password"

# 실제 다운로드 없이 완료로 등록
ps5dl download "Game Title" --completed
```

---

### `ps5dl urldown <url>`
1fichier·Datanodes·Vikingfile URL에서 직접 다운로드 후 후처리 파이프라인을 실행합니다.

```bash
ps5dl urldown "https://1fichier.com/?abc123"
ps5dl urldown "https://datanodes.to/abc123" --password "DLPSGAME.COM"
```

---

### `ps5dl completed [title]`
완료 목록을 수동으로 관리합니다.

```bash
ps5dl completed                          # 완료 목록 조회
ps5dl completed "Game Title"             # 완료로 등록
ps5dl completed "Game Title" --remove    # 완료 목록에서 제거
```

---

### `ps5dl exclude [title]`
배치 다운로드 제외 목록을 관리합니다.

```bash
ps5dl exclude                            # 제외 목록 조회
ps5dl exclude "Game Title"               # 제외 등록
ps5dl exclude "Game Title" --remove      # 제외 해제
```

---

### `ps5dl dupe [query]`
로컬·완료 목록에 있는 게임의 중복 웹 타이틀을 찾아 완료로 표시합니다.

```bash
ps5dl dupe "Endling"
```

---

### `ps5dl open <title>`
매칭되는 게임의 웹 다운로드 페이지를 기본 브라우저로 엽니다.

```bash
ps5dl open "After The Fall"
```

---

## 5. 다운로드 및 후처리 프로세스 흐름

### 지역 우선순위
섹션 시도 순서: **KOR (exFAT) → KOR → USA (exFAT) → EUR (exFAT) → USA → EUR → 기타**

### 백포트 필터링
각 섹션의 본문에서 `"Works on X.xx and higher"` 노트를 파싱합니다:
- 요구 펌웨어 ≤ `USER_FIRMWARE` → 호환 → 해당 섹션 사용
- 요구 펌웨어 > `USER_FIRMWARE` → 비호환 → 다음 섹션으로 skip
- 노트 없음 → region 이름 기반 fallback 로직 적용

**예시** (`USER_FIRMWARE=7`):
- 섹션 `"Works on 9.xx and higher"` → skip
- BackPort 섹션 `"Works on 7.xx and higher"` → 선택 및 다운로드

### 다운로드 흐름
1. **스크래퍼**: WordPress REST API로 dlpsgame.com 조회 (Cloudflare 차단 우회)
2. **링크 디코더**: Base64 페이로드 해독, `clk.sh`·`downloadgameps3.net` 리다이렉트 처리
3. **호스트 선택**: 1fichier → Datanodes 우선. 지원 불가 호스트는 브라우저 폴백
4. **Dead link 재시도**: 링크 사망(404) 시 동일 섹션 내 다음 호스트로 재시도
5. **다운로드**:
   - *내장 모드*: 1fichier API 스트리밍 또는 Datanodes 다단계 흐름
   - *FDM 모드* (`DOWNLOAD_MANAGER=FDM`): direct URL 취득 후 FDM CLI에 위임, 파일 완료 시까지 폴링
6. **exFAT 실패 처리**: exFAT 섹션 다운로드 실패 시 `.exfat` → `.failed` 리네임 후 해당 게임 skip (다른 섹션 시도 없음)

### 후처리 흐름
다운로드 완료 후:
1. **메타데이터**: `param.json` 부분 추출로 실제 타이틀·PPSA·버전 파싱
2. **비밀번호 감지**: 비밀번호 없이 시도 → `DLPSGAME.COM` → `dlpsgame.com` → 스크랩 비밀번호 순차 대입
3. **암호화·분할 압축인 경우**:
   - UnRAR/7z로 추출
   - `eboot.bin`이 루트가 되도록 폴더 구조 평탄화
   - 원본 아카이브 삭제
   - Bandizip으로 재압축: `bz a -r -fmt:7z -l:7 "output.7z"`
4. **비암호화인 경우**: `{Title} [PPSA][vXX.XX]{ext}` 포맷으로 리네임 보존
5. **exFAT 파일**: Bandizip으로 `.7z` 압축
6. **등록**: `data/downloaded.xml`에 최종 파일명 기록

### 최종 파일명 규칙

| 상황 | 결과물 |
|------|--------|
| 암호화·분할 압축 아카이브 | `{Title} [PPSA][ver].7z` |
| 무암호 아카이브 | `{Title} [PPSA][ver]{.rar/.zip/.7z}` |
| exFAT raw 이미지 | `{Title} [PPSA][ver].7z` |
| DLC, UNLOCK, UPDATE | `{Title} [PPSA][TYPE]{ext}` |
| exFAT 다운로드 실패 | `original_name.failed` |
