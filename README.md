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

## Use

```bash
git clone https://github.com/a2ajinkya/phone-pi.git
cd phone-pi
pi --agent-dir .
```

Or symlink the pieces you want into `~/.pi/agent/`.

Dependencies vary by skill — check individual skill files for details.

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