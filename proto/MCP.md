# MCP server: Thai excise-law search for craft brewers

`proto/mcp_server.py` exposes the chatbot's corpus to any MCP client (Claude Code, Claude Desktop,
other agents). It is a thin client of the running chatbot server, so the index and the reranker
load once.

## Run

1. Chatbot server (loads the reranker, about 60 s):
   `uv run --with chromadb --with numpy --with sentence-transformers --with torch python proto/server.py --port 8796`
2. MCP, either
   - local stdio: `uv run --with "mcp<2" python proto/mcp_server.py` (what `.mcp.json` → `craft-beer-excise` runs), or
   - HTTP on this machine: `uv run --with "mcp<2" python proto/mcp_server.py --http --port 8798`
     → `http://127.0.0.1:8798/mcp` (`.mcp.json` → `craft-beer-excise-http`).

Claude Code picks up `.mcp.json` in the repo root when started here (it asks once to trust it).

## Tools

| Tool | What it returns |
|---|---|
| `search_law(query, mode, k, rerank)` | `mode`: `hybrid` (BM25 + vectors + reranker, the chatbot), `semantic` (vectors only), `keyword` (BM25 only). Hits with title, ข้อ, page, dates, scores, text, `pdf`, `ocr_md`, plus a `markdown` block |
| `ask_law(question)` | The chatbot: up to 3 quoted clauses that pass the gate (rerank ≥ 0.5), the best span of each, or `answered: false` |
| `find_pdf(title_words, k)` | Documents whose title / type / year contain every word, newest in force first, with the PDF link |
| `read_ocr(doc_key, page_from, page_to, max_chars)` | OCR text page by page, the section list, links |
| `corpus_stats()` | Documents, sections, embedding model, reranker on/off |

Every result carries links: `pdf` (official PDF on lawelcs.excise.go.th) and `ocr_md`
(`/api/doc.md?key=…`, the whole document as markdown: citation header, then OCR text by page).

## Test

`uv run --with "mcp<2" python proto/mcp_test.py` (stdio) or `… mcp_test.py --http`. It calls every
tool and checks OCR quality on the documents it finds.

Result 2026-11-21 (both transports): 5 tools listed; three search modes return hits; `ask_law`
answers the licence-fee question (ใบอนุญาตผลิตสุราแช่ชนิดเบียร์ ประเภทที่ 1 ฉบับละ 60,000 บาท, 748 ms)
and refuses the IPA-hops question; `find_pdf "ค่าธรรมเนียม ใบอนุญาต"` finds 4 documents with links.

## OCR quality (OpenThai)

Counted over every OCR run at the time (814 runs, 6,640 pages: some documents were OCR'd more than once).
The indexed corpus is **773 documents, 5,897 pages** (one OCR run per document; 805 PDFs in the manifest,
of which 773 have OCR text that `paths.docs()` keeps) and 14,383 ข้อ/มาตรา sections.

- Clean text: on the sampled pages 93% Thai characters, no stray symbols, no split ำ, no orphan marks.
- Known faults, counted over all pages:
  - `ข้อ N` read as `ข N`: 536 against 3,650 correct (about 13%) — section labels such as "ขอ 24".
  - tone mark lost in `กลั่น` → `กลัน`: 55 against 1,228 (about 4%).
  - a มาตรา number dropped (`มาตรา วรรคหนึ่ง`): 49 against 3,993 (about 1%).
  - Gazette page headers (`หน้า 15`, `เล่ม 142 ตอนที่ …`) stay inside the text.
- Verdict: good enough to search and to quote with a citation; numbers and marks must be checked
  against the PDF before anyone relies on them, which is why every answer links the PDF.
