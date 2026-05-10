---
name: storage-map
description: Precise phone storage navigation. Use when the user needs to find, locate, search, or browse files on their device — especially screenshots, camera photos, work documents, WhatsApp media, identity documents, bank statements, insurance policies, flight bookings, notes, e-books, APKs, or screen recordings. Also use for "where is", "find my", "look for", "search my phone", or "show me my". Loads a pre-built storage index for targeted lookups instead of scanning.
---

# Storage Map

Loads a pre-built directory index to find files without scanning the entire filesystem.

## Map file

```
/storage/emulated/0/Documents/storage-map.md
```

Read it when you need to locate files. It contains a complete directory tree, per-folder file counts, naming conventions, and a quick-reference table mapping file types to paths.

## Quick paths (most common)

| Need | Path |
|------|------|
| Screenshots | `~/storage/pictures/Screenshots/` |
| Camera photos/videos | `~/storage/dcim/Camera/` |
| All WhatsApp media | `~/storage/shared/Android/media/com.whatsapp/WhatsApp/Media/` |
| Identity docs (Aadhaar, DL, RC) | `~/storage/shared/Documents/DigiLocker/` |
| Bank statements | `~/storage/downloads/` |
| Personal notes | `~/storage/shared/Documents/Notes/` |
| Finance records | `~/storage/shared/Documents/Finance/` |
| Screen recordings | `~/storage/shared/Movies/` |
| E-books | `~/storage/downloads/` |
| APK files | `~/storage/downloads/*.apk` |
| Code projects | `~/storage/code/` |

## Search patterns

For targeted searches within large directories:

```bash
# Find PDFs by keyword in Download/
ls ~/storage/downloads/*.pdf | grep -i "keyword"

# Find recent screenshots
ls -t ~/storage/pictures/Screenshots/ | head -20

# Find bank statements
ls ~/storage/downloads/ | grep -iE "statement|bank"

# Find flight/booking invoices
ls ~/storage/downloads/ | grep -iE "flight|booking|ticket"
```

## Sizes at a glance (approximate)

- WhatsApp media: significant
- Camera: thousands of files
- Downloads: hundreds of PDFs, office docs, and APKs
- Screenshots: varies
- Free space: depends on device
