# phone-pi

My [pi coding agent](https://github.com/earendil-works/pi-coding-agent) setup running on Termux (Android).

## Contents

### Extensions (`extensions/`)
| File | Description |
|------|-------------|
| [`collapsed-tools.ts`](extensions/collapsed-tools.ts) | Collapsed tool output — shows call + status lines, hides body. Press `ctrl+o` to expand. |
| [`docorg.ts`](extensions/docorg.ts) | Document organization pipeline — queue, AI name generation, review UI, and rename. |
| [`termux-input.ts`](extensions/termux-input.ts) | Enhanced Android input via Termux:API dialogs. ENTER on empty = keyboard, Ctrl+Shift+V = voice. |

### Skills (`skills/`)
| Skill | Description |
|-------|-------------|
| [`docorg`](skills/docorg/) | Organize document downloads with AI-generated filenames and batch review. |
| [`liteparse-ingest`](skills/liteparse-ingest/) | Ingest PDFs, DOCX, XLSX, images via LiteParse. |
| [`storage-map`](skills/storage-map/) | Precise phone storage navigation using a pre-built index. |
| [`tavily-search`](skills/tavily-search/) | LLM-optimized web search via Tavily CLI. |
| [`tavily-extract`](skills/tavily-extract/) | Extract clean markdown from specific URLs. |
| [`tavily-crawl`](skills/tavily-crawl/) | Crawl websites and save pages as local markdown. |
| [`tavily-map`](skills/tavily-map/) | Discover all URLs on a website without extracting content. |
| [`tavily-research`](skills/tavily-research/) | Deep multi-source AI research with citations. |
| [`tavily-dynamic-search`](skills/tavily-dynamic-search/) | Programmatic web search with context isolation. |
| [`tavily-cli`](skills/tavily-cli/) | Unified Tavily CLI integration (search, extract, crawl, research). |
| [`tavily-best-practices`](skills/tavily-best-practices/) | Production-ready Tavily integration patterns. |

### Config
- [`settings.json`](settings.json) — Provider and model defaults (no API keys).

## Setup

1. Install pi: `npm install -g @earendil-works/pi-coding-agent`
2. Clone this repo:
   ```bash
   mkdir -p ~/.pi/agent
   git clone https://github.com/a2ajinkya/phone-pi.git ~/.pi/agent
   ```
3. Install dependencies (e.g. Tavily CLI, LiteParse, Termux:API)
4. Configure your own API keys in `~/.pi/agent/auth.json`

> **Note**: `auth.json` (API keys) and `sessions/` (conversation history) are excluded — they contain secrets and personal data.