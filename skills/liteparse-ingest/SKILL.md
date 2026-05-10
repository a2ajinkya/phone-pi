---
name: liteparse-ingest
description: >
  Ingest documents (PDF, DOCX, XLSX, PPTX, images) into agent context via liteparse.
  Trigger when user says: "parse this document", "read this PDF", "what's in this file",
  "ingest this doc", "OCR this", "extract text from", "show me this document",
  "screenshot this page", "highlight where it says", "batch parse these files",
  or references a document file they want content from.
allowed-tools: Bash(lit, liteparse, ingest-*)
---

# liteparse-ingest

Document ingestion via [LiteParse](https://github.com/run-llama/liteparse) — fast, local PDF parsing with spatial text, OCR, and bounding boxes.

Globally installed via npm: `@llamaindex/liteparse` (binary: `lit`).

## Decision tree

```
User points at a document file
│
├─ Single file?
│  ├─ Want structured text with positions?   → ingest-parse <file> [pages]
│  ├─ Just want plain text, fast?             → ingest-text <file> [pages]
│  ├─ Want to see pages visually?             → ingest-screenshot <file> [pages] [-d <dir>]
│  │
│  └─ Remote URL? (doesn't work with CLI!)   → curl -sLO URL && ingest-parse <downloaded-file>
│
├─ Multiple files in a directory?           → ingest-batch <input-dir> [output-dir]
│
└─ User wants a quick summary of the doc?     → ingest-info <file>
```

## Quick reference

```bash
# ★★★ Primary workflows ★★★

# Parse an entire document to JSON (structured text + bounding boxes)
ingest-parse report.pdf

# Parse only specific pages
ingest-parse report.pdf 1-5,10,15-20

# Get just the plain text (faster, lighter)
ingest-text report.pdf
ingest-text report.pdf 1-3   # pages 1-3 only

# Screenshot pages for visual inspection
ingest-screenshot report.pdf 1-5

# Quick doc info (page count, format, size)
ingest-info report.pdf

# Batch parse an entire directory of documents
ingest-batch ./invoices/

# ★★★ Raw lit commands (for fine control) ★★★

# Parse to JSON (default: entire document)
lit parse document.pdf --format json -q

# Parse to JSON, specific pages
lit parse document.pdf --format json -q --target-pages "1-5,10"

# Parse to plain text
lit parse document.pdf --format text -q

# Parse with higher DPI for better OCR
lit parse document.pdf --format json -q --dpi 300

# Parse with external OCR server
lit parse document.pdf --format json -q --ocr-server-url http://localhost:8828/ocr

# Password-protected PDF
lit parse document.pdf --format json -q --password "s3cret"

# Disable OCR (faster for text-only PDFs)
lit parse document.pdf --format json -q --no-ocr

# Use custom config file
lit parse document.pdf --format json -q --config ./liteparse.config.json

# Screenshots
lit screenshot document.pdf -o ./screenshots
lit screenshot document.pdf --target-pages "1-5" --dpi 300 --format png -o ./screenshots
lit screenshot document.pdf --target-pages "1-5" --password "s3cret" -o ./screenshots

# Batch parse
lit batch-parse ./input-dir ./output-dir --recursive --format json -q
lit batch-parse ./input-dir ./output-dir --extension .pdf --format json -q
```

## Wrapper scripts

Convenience scripts live alongside the skill (also available at `INGEST_BIN` if copied to PATH):

| Script | Purpose | Syntax |
|--------|---------|--------|
| `ingest-parse` | Parse doc → JSON (structured text with positions) | `ingest-parse <file> [pages]` |
| `ingest-text` | Parse doc → plain text only (faster) | `ingest-text <file> [pages]` |
| `ingest-screenshot` | Screenshot pages → PNG images | `ingest-screenshot <file> [pages]` |
| `ingest-batch` | Parse all docs in a directory | `ingest-batch <input-dir> [output-dir]` |
| `ingest-info` | Quick doc summary (pages, format, size) | `ingest-info <file>` |

All scripts:
- Output to stdout by default (agent reads it directly)
- Accept an optional page range as the second argument
- Use `-q` internally (quiet mode)

## Output: JSON structure

When parsing with `--format json`, the result looks like:

```json
{
  "pages": [{
    "page": 1,
    "width": 612,
    "height": 792,
    "text": "Full page text with spatial layout preserved...",
    "textItems": [
      {
        "text": "Revenue grew 15%",
        "x": 72, "y": 200,
        "width": 150, "height": 12,
        "fontName": "Helvetica",
        "fontSize": 10
      }
    ],
    "boundingBoxes": [
      { "x1": 72, "y1": 200, "x2": 222, "y2": 212 }
    ]
  }]
}
```

- `text` — full page text with spatial layout (newlines, indentation preserved)
- `textItems[].text` — individual text fragment
- `textItems[].x/y/width/height` — position in PDF points (72 points = 1 inch, origin top-left)
- `textItems[].fontName` — e.g. "Helvetica", "Times-Roman", "OCR" (OCR-detected text)
- `textItems[].fontSize` — font size in PDF points
- `boundingBoxes` — axis-aligned boxes `{x1,y1,x2,y2}` for each text line
- Screenshot pixel coords: `pixel = pdf_point × dpi / 72`

## OCR: when it triggers

OCR runs automatically only on pages that need it:
- Pages with **embedded images** (charts, photos, scanned content)
- Pages with **very little native text** (less than ~100 chars) — consistent with scan-only docs
- Pages with **garbled text** (fonts with broken encoding maps that produce mojibake)

OCR does NOT run on pages with healthy selectable text — this keeps parsing fast.

OCR language: defaults to `en`. Override with `--ocr-language`. Tesseract uses ISO 639-3 codes: `eng`, `fra`, `deu`, `jpn`, `chi_sim`, etc. HTTP OCR servers use ISO 639-1: `en`, `fr`, `de`, `ja`, `zh`.

## Screenshots

Screenshots are rendered at the configured DPI (default 150) via PDFium for high quality.

When the user asks "where does it say X" or "show me the chart on page 3" or "highlight the revenue number":
1. Parse with `--format json` to get bounding box coordinates
2. Screenshot the relevant pages via `ingest-screenshot`
3. Coordinates × DPI/72 = pixel positions

## Configuration

Create a `liteparse.config.json` anywhere for custom defaults:

```json
{
  "ocrLanguage": "en",
  "ocrEnabled": true,
  "maxPages": 1000,
  "dpi": 150,
  "outputFormat": "json",
  "preciseBoundingBox": true,
  "preserveVerySmallText": false
}
```

Apply with: `lit parse file.pdf --config liteparse.config.json -q`

## Available CLI flags (all lit commands)

| Flag | Commands | Description |
|------|----------|-------------|
| `--format <json\|text>` | parse, batch-parse | Output format (default: text) |
| `--target-pages <pages>` | parse, screenshot | Page range e.g. `"1-5,10"` |
| `-q / --quiet` | all | Suppress progress output |
| `-o / --output <file>` | parse | Write to file instead of stdout |
| `--no-ocr` | parse, batch-parse | Disable OCR |
| `--ocr-language <lang>` | parse, batch-parse | Language code for OCR |
| `--ocr-server-url <url>` | parse, batch-parse | External OCR server |
| `--dpi <n>` | all | Render DPI (default: 150) |
| `--max-pages <n>` | parse, batch-parse | Max pages to process (CLI default: 10000) |
| `--password <pw>` | parse, screenshot, batch-parse | Password for encrypted docs |
| `--num-workers <n>` | parse, batch-parse | Parallel OCR workers (default: CPU-1) |
| `--no-precise-bbox` | parse, batch-parse | Skip bounding box calculation |
| `--preserve-small-text` | parse, batch-parse | Keep very small text |
| `--recursive` | batch-parse | Recurse into subdirectories |
| `--extension <ext>` | batch-parse | Filter by extension (e.g. `.pdf`) |
| `--config <file>` | all | Load options from JSON file |

## Error guide

| Symptom | Fix |
|---------|-----|
| "This PDF is password-protected" | Add `--password "the_password"` |
| "LibreOffice is not installed" | `pkg install libreoffice` (may not work on Android — fall back to parsing as PDF only) |
| "ImageMagick is not installed" | `pkg install imagemagick` (may not work on Android — images without text won't convert) |
| Tesseract download failure | Set `TESSDATA_PREFIX` env var to pre-downloaded traineddata dir, or disable OCR with `--no-ocr` |
| No OCR output on image | OCR needs ImageMagick to convert images to PDF first; on Android, pass images through external OCR |
| Empty text on a scanned page | Try higher DPI: `--dpi 300`, or use an external OCR server via `--ocr-server-url` |

## Constraints

- Always use `-q` (quiet) flag — progress output goes to stderr and clutters agent context
- Prefer `--format json` — gives structured data the agent can reason about programmatically
- Never use `--target-pages` unless the user explicitly asks for specific pages (or you know which pages you need)
- `--max-pages` defaults to 10000 in the CLI; the skill defaults to 1000 (config default)
- **CLI does NOT support stdin/pipe** — `cat file.pdf | lit parse -` will fail. Always pass a file path
- For remote URLs, download first: `curl -sLO url && ingest-parse <file>`
- On Android/Termux: LibreOffice and ImageMagick may not be available — warn the user if they try to parse DOCX/XLSX/images, and suggest converting to PDF first