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

Globally installed: `lit` / `liteparse` v1.5.3.

## Decision tree

```
User points at a document file
│
├─ Single file?
│  ├─ PDF with selectable text?         → lit parse file --format json -q
│  ├─ PDF with no text (scanned/image)? → lit parse file --format json -q  (OCR auto-kicks in)
│  ├─ Office doc (DOCX/XLSX/PPTX)?      → lit parse file --format json -q  (auto-converts via LibreOffice)
│  ├─ Image (PNG/JPG/etc)?              → lit parse file --format json -q  (auto-converts via ImageMagick + OCR)
│  └─ Remote URL?                       → curl -sL URL | lit parse - --format json -q
│
├─ Multiple files in a directory?       → ingest-batch <input-dir> <output-dir>
│
├─ User wants page screenshots?         → lit screenshot file -o ./screenshots
│
├─ User wants visual citations?         → ingest-cite <file> <phrase>
│  (find phrase + screenshot + highlight)
│
└─ Just want plain text?                → lit parse file --format text -q
```

## Quick reference

```bash
# The workhorse: parse to JSON (stdout)
lit parse document.pdf --format json -q

# Write to file instead of stdout
lit parse document.pdf --format json -q -o result.json

# Parse specific pages only
lit parse document.pdf --format json -q --target-pages "1-5,10"

# Disable OCR for pure-text PDFs (faster)
lit parse document.pdf --format json -q --no-ocr

# Higher DPI for better OCR accuracy
lit parse document.pdf --format json -q --dpi 300

# Use external OCR server (EasyOCR/PaddleOCR)
lit parse document.pdf --format json -q --ocr-server-url http://localhost:8828/ocr

# Password-protected PDFs
lit parse secure.pdf --format json -q --password "s3cret"

# Read from stdin (piped or remote)
cat document.pdf | lit parse - --format json -q
curl -sL https://example.com/report.pdf | lit parse - --format json -q

# Screenshots
lit screenshot document.pdf -o ./screenshots
lit screenshot document.pdf --target-pages "1-5" --dpi 300 -o ./screenshots

# Batch: parse entire directory
lit batch-parse ./input-dir ./output-dir --recursive --format json -q
```

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
        "fontSize": 10,
        "confidence": 1.0
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
- `textItems[].confidence` — 1.0 for native PDF text, <1.0 for OCR text
- `textItems[].fontName` — e.g. "Helvetica", "Times-Roman", "OCR" (OCR-detected text)
- `boundingBoxes` — deprecated alias, use `textItems` coordinates directly

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
2. Screenshot the relevant pages
3. Use `ingest-cite` to overlay highlights (coordinates × DPI/72 = pixels)

## Wrapper scripts

Use these from `~/storage/code/liteparse-ingest/bin/` for multi-step workflows:

| Script | Purpose |
|--------|---------|
| `ingest-parse <file>` | Parse to JSON, validate, print summary stats |
| `ingest-batch <in-dir> <out-dir>` | Batch parse directory recursively |
| `ingest-cite <file> <phrase>` | Visual citation: parse + find + screenshot + highlight |
| `ingest-url <url>` | Fetch remote PDF and parse in one step |

## Configuration

Default config at `~/storage/code/liteparse-ingest/config/liteparse.config.json`:

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

Apply config with: `lit parse file.pdf --config ~/storage/code/liteparse-ingest/config/liteparse.config.json -q`

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
- Never use `--target-pages` unless the user explicitly asks for specific pages
- `--max-pages` defaults to 10000 in the CLI; the agent should default to 1000 via config
- If `lit` is not found, it's installed globally at `/data/data/com.termux/files/usr/bin/lit`
- On Android/Termux: LibreOffice and ImageMagick may not be available — warn the user if they try to parse DOCX/XLSX/images, and suggest converting to PDF first
