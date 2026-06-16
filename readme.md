# PS5 Downloader CLI (`ps5dl`)

`ps5dl` is a Node.js-based Command Line Interface (CLI) utility designed to automate the process of downloading PS5 games from web sources, converting downloaded archives into `.ffpfsc` image formats, and managing your local library metadata. It synchronizes with your LaunchBox database exports to determine which games you still need to download (TBD).

---

# English Guide

## Table of Contents
1. [Prerequisites & Preparations](#1-prerequisites--preparations)
   - [LaunchBox Database Export (`PS5.xml`)](#launchbox-database-export-ps5xml)
   - [1fichier API Key Registration](#1fichier-api-key-registration)
   - [Converter Tool Setup (`ps5-ffpfs-cli`)](#converter-tool-setup-ps5-ffpfs-cli)
2. [Environment Configuration (`.env`)](#2-environment-configuration-env)
3. [Installation](#3-installation)
4. [Command Reference & Usage](#4-command-reference--usage)
5. [Automatic Download & Conversion Pipeline](#5-automatic-download--conversion-pipeline)

---

## 1. Prerequisites & Preparations

Before running the CLI, you must set up the following prerequisites:

### LaunchBox Database Export (`PS5.xml`)
The tool matches your current local game library against the web database to determine missing titles.
1. In **LaunchBox**, select your PS5 games and export them as a Playlist XML file (choose the option that exports it as a playlist/library XML structure).
2. Rename the exported XML file to **`PS5.xml`**.
3. Place the file inside the project directory at:
   `C:\Code\PS5_Downloader\data\PS5.xml`

### 1fichier API Key Registration
To allow automated high-speed downloads without browser interactions:
1. Log in to your account on [1fichier.com](https://1fichier.com/) (a Premium/Bypass subscription is required for direct high-speed API downloads).
2. Go to your **Parameters** or **API** settings page.
3. Locate or generate your **API Key** (API Token).
4. Save this token inside the `.env` file under the key `FICHIER_API_KEY`.

### Converter Tool Setup (`ps5-ffpfs-cli`)
Downloaded games are usually archived `.rar` packages. The tool uses `ps5-ffpfs-cli` to convert them directly into compressed `.ffpfsc` disk images.
1. Download or install `ps5-ffpfs-cli` (a Python-based cli tool or standalone binary).
2. Note down its executable location or python entry file path.
3. Define the path and arguments in the `.env` file.

---

## 2. Environment Configuration (`.env`)

Create a `.env` file in the root of the project (`C:\Code\PS5_Downloader\.env`) with the following variables:

```env
# 1fichier API Key (Do not share this key)
FICHIER_API_KEY=your_1fichier_api_key_here

# Directory where downloaded files and converted .ffpfsc images will be saved
DOWNLOAD_DIR=H:\Download

# Cache expiration for web game list (in hours)
CACHE_TTL_HOURS=24

# Path to the converter executable (or "python" if running the python script)
CONVERTER_PATH=python

# Command template arguments for the converter
# {input}, {output}, and {password} are automatically replaced by the CLI during execution
CONVERTER_ARGS=C:\path\to\ps5-ffpfs-cli\cli.py {input} {output} --password {password} --overwrite
```

---

## 3. Installation

1. Open your terminal in the project directory (`C:\Code\PS5_Downloader`).
2. Install the Node.js package dependencies:
   ```bash
   npm install
   ```
3. Link the package globally so you can execute the command from any directory:
   ```bash
   npm link
   ```
   *Now you can run the CLI globally using the command: `ps5dl`.*

---

## 4. Command Reference & Usage

### 1. Listing Games (`ps5dl list`)
Lists games from different sources. You can filter by name (`--name`/`-n`) or limit the output size (`--limit`/`-l`).
*   **List all games** (Local, Web, and Downloaded status combined):
    ```bash
    ps5dl list all
    ```
*   **List only local games** (derived from `data/PS5.xml`):
    ```bash
    ps5dl list local
    ```
*   **List only downloaded games** (derived from `data/downloaded.xml`):
    ```bash
    ps5dl list downloaded
    ```
*   **List games found on the web**:
    ```bash
    ps5dl list web
    ```
*   **List TBD (To Be Downloaded) games** (Web games that do NOT exist in Local or Downloaded list, and are not Excluded):
    ```bash
    ps5dl list tbd
    ```
*   **Filter list by name and limit output count**:
    ```bash
    ps5dl list tbd -l 10 -n "Spider-Man"
    ```

### 2. Downloading Games (`ps5dl download`)
*   **Download a single game**:
    ```bash
    ps5dl download "Aeterna Noctis"
    ```
    *If there are multiple matching matches, the CLI prompts you to select one by number.*
*   **Batch download TBD games sequentially**:
    ```bash
    ps5dl download --limit 5
    ```
    *This downloads the first 5 games in your TBD list one by one.*

### 3. Excluding Games (`ps5dl exclude`)
Exclude specific games from being downloaded during batch/limit runs.
*   **Show excluded games list**:
    ```bash
    ps5dl exclude
    ```
*   **Add a game to the exclusion list**:
    ```bash
    ps5dl exclude "Game Title Here"
    ```
*   **Remove a game from the exclusion list**:
    ```bash
    ps5dl exclude "Game Title Here" --remove
    ```

### 4. Open Game Webpage (`ps5dl open`)
*   Opens the target game's webpage in your default browser:
    ```bash
    ps5dl open "After The Fall"
    ```

---

## 5. Automatic Download & Conversion Pipeline

When you run a download command:
1. **Turnstile Bypass Scraper**: The tool queries the web pages. It bypasses Cloudflare Turnstile blocks automatically by fetching the page content via the WordPress REST API endpoint or fallback manual HTML caches.
2. **Link Extraction & Decoding**: It decodes Base64-encrypted secure payloads, handles `clk.sh` short-links, extracts direct download links, and retrieves game region, PPSA codes, and archive passwords.
3. **Region Priority Routing**: It sorts download options (favoring KOR/KOR-subbed, then USA/EUR) and matches the target PPSA code with your `PS5.xml` database.
4. **Stream Downloader**: Direct streams are pulled from 1fichier API using simulated browser-like headers to prevent 404/403 blocks.
5. **Auto conversion**: Once downloading finishes, it extracts the game version (e.g., `v1.00`) and calls `ps5-ffpfs-cli` to compile the `.rar` files directly into a compressed `{Title} [PPSAxxxx][version].ffpfsc` image.
6. **Disk Cleanup & Logging**: The tool automatically deletes the original `.rar` files to save disk space and logs the downloaded game in `data/downloaded.xml`.

---
---

# 한글 가이드 (Korean Guide)

## 목차
1. [사전 준비 작업](#1-사전-준비-작업)
   - [LaunchBox 라이브러리 내보내기 (`PS5.xml`)](#launchbox-라이브러리-내보내기-ps5xml)
   - [1fichier API 키 등록](#1fichier-api-키-등록)
   - [변환 도구 설정 (`ps5-ffpfs-cli`)](#변환-도구-설정-ps5-ffpfs-cli)
2. [환경 변수 설정 (`.env`)](#2-환경-변수-설정-env)
3. [설치 방법](#3-설치-방법)
4. [명령어 사용법](#4-명령어-사용법)
5. [자동 다운로드 및 변환 프로세스 흐름](#5-자동-다운로드-및-변환-프로세스-흐름)

---

## 1. 사전 준비 작업

CLI 도구를 실행하기 전에 다음 작업이 사전에 완료되어 있어야 합니다.

### LaunchBox 라이브러리 내보내기 (`PS5.xml`)
웹 데이터베이스와 로컬 보유 게임 목록을 매핑하여 아직 보유하지 않은 게임(TBD)을 골라내는 데 사용됩니다.
1. **LaunchBox**를 실행하고 PS5 플랫폼 게임들을 선택한 뒤, 플레이리스트/라이브러리 XML 구조 파일로 내보내기(Export)를 수행합니다.
2. 내보낸 XML 파일의 이름을 **`PS5.xml`**로 변경합니다.
3. 해당 파일을 프로젝트 폴더 하위의 `data` 폴더 안에 복사해 넣습니다:
   `C:\Code\PS5_Downloader\data\PS5.xml`

### 1fichier API 키 등록
웹 브라우저의 수동 조작 없이 고속 자동 다운로드를 활성화하려면 API 토큰이 필요합니다.
1. [1fichier.com](https://1fichier.com/) 웹사이트에 로그인합니다. (API 토큰 발급 및 고속 다운로드 전송을 위해 Premium 또는 Bypass 이용권이 필요합니다.)
2. 회원 정보 관리 또는 **API settings** 페이지로 이동합니다.
3. 개인 **API Key**(API Token)를 복사합니다.
4. 이 토큰값을 `.env` 파일의 `FICHIER_API_KEY` 항목에 붙여넣습니다.

### 변환 도구 설정 (`ps5-ffpfs-cli`)
다운로드되는 파일들은 대다수 분할된 `.rar` 압축 아카이브입니다. 이를 마운트 가능한 압축 이미지 포맷(`.ffpfsc`)으로 변환합니다.
1. `ps5-ffpfs-cli` 파이썬 실행 스크립트 또는 빌드된 실행 바이너리를 준비합니다.
2. 실행 경로 또는 실행 스크립트(cli.py)의 로컬 경로를 파악합니다.
3. `.env` 파일에 경로와 실행 아규먼트를 작성합니다.

---

## 2. 환경 변수 설정 (`.env`)

프로젝트 루트 폴더(`C:\Code\PS5_Downloader\.env`)에 아래 내용으로 `.env` 파일을 작성하고 저장합니다.

```env
# 1fichier API Key (외부에 노출되지 않도록 주의)
FICHIER_API_KEY=사용자의_1fichier_api_key_입력

# 다운로드 파일 및 최종 변환본 .ffpfsc가 저장될 타겟 폴더
DOWNLOAD_DIR=H:\Download

# 웹 크롤링 목록 로컬 캐싱 주기 (시간 단위)
CACHE_TTL_HOURS=24

# 변환기 실행 파일 (Python 스크립트 구동 시 python 입력)
CONVERTER_PATH=python

# 변환기 파라미터 템플릿
# {input}, {output}, {password}는 다운로드 완료 시 CLI가 동적으로 치환합니다.
CONVERTER_ARGS=C:\path\to\ps5-ffpfs-cli\cli.py {input} {output} --password {password} --overwrite
```

---

## 3. Installation

1. 프로젝트 폴더 터미널(`C:\Code\PS5_Downloader`)을 실행합니다.
2. 필요한 Node.js 의존성 패키지를 설치합니다:
   ```bash
   npm install
   ```
3. 전역 명령어 링크를 생성하여 언제 어디서나 바로 실행할 수 있도록 설정합니다:
   ```bash
   npm link
   ```
   *이제 시스템 어디에서나 `ps5dl` 명령어를 전역적으로 사용할 수 있습니다.*

---

## 4. 명령어 사용법

### 1. 게임 목록 확인 (`ps5dl list`)
다양한 소스별 게임 목록을 조회합니다. 이름 검색(`--name`/`-n`) 및 출력 갯수 제한(`--limit`/`-l`) 옵션을 연동해 필터링할 수 있습니다.
*   **전체 게임 목록 조회** (로컬, 웹, 다운로드 여부를 통합 표시):
    ```bash
    ps5dl list all
    ```
*   **로컬 라이브러리 목록 조회** (`data/PS5.xml` 파싱 결과):
    ```bash
    ps5dl list local
    ```
*   **다운로드 완료 목록 조회** (`data/downloaded.xml` 파싱 결과):
    ```bash
    ps5dl list downloaded
    ```
*   **웹 목록 조회**:
    ```bash
    ps5dl list web
    ```
*   **TBD(아직 받지 않은) 목록 조회** (웹 게임 중 로컬/완료 목록에 없고, 제외 대상이 아닌 게임):
    ```bash
    ps5dl list tbd
    ```
*   **필터링 검색 예시 (TBD 중 Spider-Man 검색어 필터링 후 10개만 출력)**:
    ```bash
    ps5dl list tbd -l 10 -n "Spider-Man"
    ```

### 2. 게임 다운로드 및 변환 (`ps5dl download`)
*   **단건 게임 다운로드**:
    ```bash
    ps5dl download "Aeterna Noctis"
    ```
    *일치하는 게임이 여러 개 검색되면 번호 선택지(Prompt)가 제공됩니다.*
*   **TBD 목록 상위 N개 일괄 순차 다운로드**:
    ```bash
    ps5dl download --limit 5
    ```
    *아직 다운로드받지 않은 상위 5개의 게임을 하나씩 순차적으로 자동 다운로드 및 변환 작업을 수행합니다.*

### 3. 다운로드 제외 관리 (`ps5dl exclude`)
배치 다운로드 시 다운로드 대상에서 제외할 게임을 등록/해제 관리합니다.
*   **제외 등록된 전체 목록 조회**:
    ```bash
    ps5dl exclude
    ```
*   **제외 게임 등록**:
    ```bash
    ps5dl exclude "Game Title Here"
    ```
*   **제외 게임 등록 해제**:
    ```bash
    ps5dl exclude "Game Title Here" --remove
    ```

### 4. 브라우저로 웹페이지 바로 열기 (`ps5dl open`)
*   기본 웹 브라우저를 띄워 매칭되는 게임의 웹 페이지 정보를 엽니다:
    ```bash
    ps5dl open "After The Fall"
    ```

---

## 5. 자동 다운로드 및 변환 프로세스 흐름

`download` 명령을 작동시키면 백그라운드에서 다음 과정이 한 번에 연동 구동됩니다:
1. **Cloudflare Turnstile 보안 우회**: 웹 상세 정보 크롤링 시 차단 방지를 위해 WordPress REST API 엔드포인트를 호출하거나, 사전에 저장된 수동 로컬 HTML 캐시를 조회하여 Turnstile 봇 탐지 시스템을 원천 우회합니다.
2. **링크 디코딩 & 파싱**: 암호화된 Base64 페이로드를 디코딩하고 `clk.sh` 단축 링크를 풀어서 원본 1fichier 링크 주소와 압축 비밀번호(`Password: DLPSGAME.COM`)를 자동 파싱합니다.
3. **PPSA & 지역 우선순위 필터링**: 로컬 `PS5.xml` 내의 타겟 PPSA 코드와 지역 정보(한국어 패치 우선, 이외 USA -> EUR 순)를 대조해 최적의 다운로드 대상을 정렬 선별합니다.
4. **스트리밍 다운로드**: 봇 차단 필터 방지를 위해 브라우저와 동일한 User-Agent 헤더 정보를 포함하여 1fichier API 다운로드 스트림을 받아 로컬 디스크에 임시 세이브합니다.
5. **FFPFSC 자동 변환**: 다운로드가 성공하면 파일명에서 버전을 추출(예: `v1.00`)한 다음 `ps5-ffpfs-cli`를 백그라운드 호출해 다운로드 파일과 패스워드를 주입하고, 압축 해제와 압축 변환을 거쳐 `{제목} [PPSAxxxx][version].ffpfsc` 이미지 파일 작성을 자동 완료합니다.
6. **로컬 청소 및 기록**: 성공적으로 변환이 완료되면 원본 다운로드 압축 파일(`.rar`)을 삭제해 디스크 공간을 확보하고, 다운로드 데이터베이스 `data/downloaded.xml`에 성공 이력을 추가 저장합니다.
