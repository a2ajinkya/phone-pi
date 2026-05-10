# liteparse-ingest skill

AI coding agent instructions for document ingestion via [LiteParse](https://github.com/run-llama/liteparse).

## Bin scripts

Wrapper scripts in `bin/` for quick agent workflows:

| Script | What it does |
|--------|-------------|
| `ingest-parse <file> [pages]` | Parse to JSON (structured text + bounding boxes) |
| `ingest-text <file> [pages]` | Get plain text (fast) |
| `ingest-screenshot <file> [pages]` | Screenshot pages to PNG |
| `ingest-batch <input-dir> [output-dir]` | Parse all docs in a directory |
| `ingest-info <file>` | Quick document summary |

All output to stdout for agent consumption.