# thai-excise-law

Ask Thai excise law (ภาษีสรรพสามิต) questions in everyday Thai and get the exact clause back, with its
citation and the original PDF page. Built for small craft brewers. It quotes documents; it does not
write answers of its own, and when nothing matches well enough it says so instead of guessing.

**Live:** https://thai-excise-law.vercel.app · **MCP:** `https://thai-excise-law.vercel.app/mcp`

> A prototype, not legal advice. Not affiliated with the Excise Department or any association.
> OCR can drop Thai digits: always check numbers against the PDF page it links to.

## What it does

- **Search** 773 excise documents (Acts, ministerial regulations, notices, orders) split into
  14,383 ข้อ/มาตรา sections: BM25 over Thai character trigrams + embeddings, fused (RRF), a
  cross-encoder reranker (`bge-reranker-v2-m3`), and an answer gate (rerank ≥ 0.5).
- **Members' words → legal words** (`proto/terms.py`): "หิ้วเบียร์กลับ", "ไลเซ่น", "บริวผับ",
  "ใบขายเหล้าแบบ 2", English questions… each rule adds the terms the law actually uses, and the
  page shows which ones were added.
- **Newest version in force first**: cancelled and not-yet-effective documents rank last; a beer
  question puts sections only about other drinks last.
- **Every answer cites** title, ข้อ/มาตรา, page, effective date, in force or cancelled, and opens the
  original PDF at that page (or the OCR text, with the answering span highlighted).
- **Section splitter** (`proto/sections.py`) that survives OCR damage to headings: "ข 22",
  "ขอ ผู้ได้รับ" (number lost), "ขผู้ยื่น" (glued), "ขอ 1" for ข้อ 15 (a dropped digit).
- **Search map** (`#/map`): every section on a UMAP of its embedding, and one question traced through
  every stage.
- **MCP server**: `search_law`, `ask_law`, `find_pdf`, `read_ocr`, `popular_topics`, `corpus_stats`.

Eval (`proto/eval_api.py`, 56 questions, 15 of them not answerable from the corpus): 29 answered from
the expected document, 12 from another document, 0 refused, **0 of 15 no-answer questions answered**.
The QA report (`proto/QA-2026-11-21.md`) lists what still goes wrong.

## Layout

| Path | What |
|---|---|
| `proto/server.py` | the full search + API server (ChromaDB, embeddings, reranker) and the web UI |
| `proto/sections.py`, `proto/paths.py`, `proto/ingest.py` | OCR pages → sections → embeddings |
| `proto/terms.py`, `proto/textnorm.py` | members' words → legal words; Thai normalisation and trigrams |
| `proto/web/` | React + Tailwind UI (a filled government form: `DESIGN.md`) |
| `proto/mcp_server.py` | MCP over stdio or streamable HTTP, a thin client of the server |
| `proto/build_lite.py`, `proto/potion_*.py`, `deploy/` | the prebuilt, free-tier hosted version |
| `proto/eval/`, `proto/eval_*.py` | questions and evals |

## Run locally

The corpus is not in this repo. You need the PDFs from the Excise Department law site, a
`manifest.jsonl` describing them (`doc_id`, `law_id`, `title`, `type`, `effect_date`,
`cancel_date`, `url`, `path`), and one OCR text file per page. Download politely: single direct PDF
links, no bulk crawling.

```
export EXCISE_CORPUS=/path/to/excise-laws          # manifest.jsonl + PDFs
export EMBED_URL=http://127.0.0.1:11434            # any Ollama-compatible /api/embed
export EMBED_MODEL=embeddinggemma
export OCR_ROOT=/path/to/ocr                       # <YYYY-MM>/excise-<doc>/page_NNNN.txt

uv run --with chromadb --with numpy python proto/sections.py "$EXCISE_CORPUS"     # split + embed
cd proto/web && bun install && bun run build && cd ../..
uv run --with chromadb --with numpy --with sentence-transformers --with torch \
  python proto/server.py --port 8796                                              # http://127.0.0.1:8796
uv run --with "mcp<2" python proto/mcp_server.py --http --port 8798               # MCP
```

## The hosted version (Vercel, free tier)

A free serverless function cannot run ChromaDB, an embedding model or a reranker, so
`proto/build_lite.py` does that work once, offline: a numpy BM25 index, the reader text, the map,
and the full pipeline's answers for the known questions. Section vectors come from a static
embedding model (`minishlab/potion-multilingual-128M`, trimmed to Thai/Latin tokens, int8, 76 MB),
so the function embeds a question itself in ~3 ms with no API key. See `deploy/README.md`.

## License

MIT for the code. The law texts belong to their public sources; the illustrations in
`proto/web/public/img/` were drawn with an AI image model.
