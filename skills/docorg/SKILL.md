---
name: docorg
description: Organize messy document downloads by scanning files, extracting dossiers, generating clean names via AI, and applying renames with full audit logging. Reads naming-rules.md for per-category templates (flights, bills, insurance, salary, etc).
---

# docorg Skill

Organizes downloaded PDFs, DOCX, PPTX into searchable filenames.

## Database
- Path: `~/storage/code/docorg/docorg.db`
- Schema: `files`, `dossiers`, `names`, `rename_log`
- 441 files scanned, ~418 pending naming

## User Workflow (one command)

User types: `/organize`

Primary extension flow:
1. Runs `doc-queue` and loads latest `queue/batch-*.json`
2. Reads `naming-rules.md`, generates proposals via built-in model call:
   - provider: `openrouter`
   - model: `openai/gpt-5.4-mini`
3. Validates/sanitizes proposal JSON
4. Imports proposals via `doc-name`
5. Opens full-screen two-pane review for low-confidence items (`<0.85`):
   - left pane: full old filenames
   - right pane: full new filename + critical metadata
6. Applies decisions:
   - auto-approve high confidence via `doc-approve-high 0.85`
   - selected approvals/rejections via `doc-approve-ids` / `doc-reject-ids`
7. Final confirm runs `doc-apply`
8. If final apply is cancelled, batch approve/reject decisions are reset to `pending`
9. Extension posts formatted phase updates into the main chat area so progress is always visible

Compatibility path:
- Tool `docorg_process_proposals` is still available for externally generated proposal arrays.

## Review UI hotkeys
- `↑/↓` move selection
- `space` cycle decision for focused item (undecided -> approve -> reject)
- `a` approve focused item
- `x` reject focused item
- `A` approve all low-confidence items
- `X` reject all low-confidence items
- `R` reset all low-confidence decisions to undecided
- `Enter` confirm review decisions
- `Esc` cancel review

If user asks for manual status/review operations, use scripts:
- `~/storage/code/docorg/bin/doc-pending-review [limit]`
- `~/storage/code/docorg/bin/doc-approve-ids <dossier_id...>`
- `~/storage/code/docorg/bin/doc-reject-ids <dossier_id...>`
- `~/storage/code/docorg/bin/doc-approve-high [threshold]`

## Slash command
- `/organize` — primary workflow command (optionally `/organize 10`)

Status or review operations should be executed as scripts/tools when the user asks in natural language, not via extra slash commands.

## Important constraints
- Always use `pypdf`-extracted text from dossiers (never open raw PDFs directly)
- Never install `pdfminer.six` or `pymupdf` (triggers Android compile hell)
- Dash shell — use `[` not `[[` in scripts
- Original files are archived to `~/storage/code/docorg/archive/YYYY-MM/` before rename
