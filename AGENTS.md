# AGENTS.md — Repo Architecture

## The Two-Layer Git Setup

This repo (`~/phone-pi/`) is the **public face** — a clean, curated copy of the user's pi agent setup, scrubbed of personal data. It ships to `a2ajinkya/phone-pi` on GitHub.

The **working repos** live separately under `~/storage/code/`:

| Working Repo | Purpose | Git |
|-------------|---------|-----|
| `~/storage/code/docorg/` | Document organization tool (DB, scripts, logs) | Local only — **never pushed** |
| `~/storage/code/pi-web/` | Phone-first web UI for pi | Local only |
| `~/storage/code/liteparse/` | Local document parsing (fork) | Local only |

### How it works

1. Development happens in the working repos under `~/storage/code/`
2. When ready to publish, relevant files are **copied** (not symlinked) into `~/phone-pi/`
3. This repo is scrubbed of secrets, local paths, database files, devlogs, etc.
4. Only the clean, reusable pi extensions and skills land on GitHub

### What's in this repo

- `skills/` — pi skill definitions (docorg, liteparse-ingest, storage-map, tavily-*)
- `extensions/` — pi extension code (docorg.ts, termux-input.ts, collapsed-tools.ts)
- `settings.json` — pi agent configuration

### What's NOT in this repo

- Databases, logs, devlogs, working documents
- Full app source (pi-web, docorg backend)
- Personal files from `~/storage/downloads/`, `~/storage/dcim/`, etc.

## Phone-first constraints

- Small screen, touch keyboard, no physical Shift+Tab
- Iteration via screenshots — user says "look at my last screenshot"
- TUI/UI aesthetics matter: dark themes, compact cards, color-coded states
- Voice input via `termux-dialog`

## Custom tools available in the live setup

- `docorg_process_proposals` — process /organize proposals into DB
- `liteparse` — parse documents (PDF, DOCX, XLSX, PPTX, images)
- `tvly` — web search, extract, crawl, deep research via Tavily CLI
- `termux-dialog` — native Android dialogs (speech, confirmations)
