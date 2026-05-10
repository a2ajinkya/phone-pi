# phone-pi

A collection of custom **skills** and **extensions** for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent), designed to run on **Termux (Android)**.

Bridges the gap between a terminal-based AI coding assistant and the mobile environment — enabling document management, web research, phone file navigation, and enhanced text input on Android.

## Features

| What | Extensions | Skills |
|------|------------|--------|
| **Document organization** — AI generates clean filenames for downloaded PDFs/DOCX with a review UI | [`docorg.ts`](extensions/docorg.ts) | [`docorg`](skills/docorg/) |
| **Document ingestion** — Parse PDFs, DOCX, XLSX, images into LLM context | — | [`liteparse-ingest`](skills/liteparse-ingest/) |
| **Phone storage nav** — find files by type instantly via pre-built index | — | [`storage-map`](skills/storage-map/) |
| **Android input** — hardware keyboard + on-screen dialog + speech-to-text | [`termux-input.ts`](extensions/termux-input.ts) | — |
| **Collapsed output** — clean tool rendering, press Ctrl+O to expand | [`collapsed-tools.ts`](extensions/collapsed-tools.ts) | — |
| **Web search & research** — Tavily CLI integration for search, extract, crawl, deep research | — | 8 [`tavily-*`](skills/) skills |

## How to use

### Prerequisites

- [pi coding agent](https://github.com/earendil-works/pi-coding-agent) installed globally:
  ```bash
  npm install -g @earendil-works/pi-coding-agent
  ```
- Termux on Android (with [Termux:API](https://wiki.termux.com/wiki/Termux:API) for input/speech features)

### Quick start

```bash
# Clone into your pi agent directory (or symlink individual files)
git clone https://github.com/a2ajinkya/phone-pi.git ~/phone-pi

# Symlink the extensions
ln -s ~/phone-pi/extensions/*.ts ~/.pi/agent/extensions/

# Symlink the skills
for d in ~/phone-pi/skills/*/; do
  ln -s "$d" ~/.pi/agent/skills/
done
```

### Dependencies by skill

| Skill | Requires |
|-------|----------|
| `tavily-*` | [Tavily CLI](https://github.com/tavily-ai/cli) (`curl -fsSL https://cli.tavily.com/install.sh \| bash`) + a Tavily API key |
| `liteparse-ingest` | [LiteParse](https://github.com/run-llama/liteparse) (`npm install -g liteparse`) |
| `docorg` | SQLite3, a Python backend at `~/storage/code/docorg/` |
| `termux-input` | `pkg install termux-api` |

### Config

- [`settings.json`](settings.json) — Provider/model defaults (no API keys included)
- Create your own `~/.pi/agent/auth.json` with your API keys

> **Note**: `auth.json` (API keys/secrets) and `sessions/` (conversation history) are **not** included in this repo.

## Skill index

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

## License

MIT — use freely, adapt as you like.