# Hosted build (Vercel, free tier)

Live: https://thai-excise-law.vercel.app · MCP: https://thai-excise-law.vercel.app/mcp
(project `thai-excise-law`, team Cat Lab Team, Hobby plan; Vercel login protection off, the content is public law text)

The local chatbot (`proto/server.py`) needs ChromaDB, the embedding model and the reranker.
None of that fits a free serverless function, so `proto/build_lite.py` does the heavy work once,
on the Mac, and this folder ships only files plus one small Python function.

| Path | What | Size |
|---|---|---|
| `api/index.py` | the whole API and the MCP endpoint (`/mcp`) | – |
| `data/sections.json.gz` | every section with metadata | 3 MB |
| `data/postings.npz`, `data/vocab.json` | BM25 index over Thai trigrams | 8 MB |
| `data/prebuilt.json` | full-pipeline answers (vectors + reranker) for 63 known questions | 1.7 MB |
| `data/vec.npy` | a 256-d vector for every section, static model `potion-multilingual-128M` | 7 MB |
| `data/emb.npz`, `data/tokenizer.json` | the static model cut to Thai/Latin tokens, int8: embeds a question in ~3 ms, no network | 76 MB |
| `public/` | web UI, `data/doc/<key>.json` reader text (773), `data/map.json` | 56 MB |

`data/` and `public/` are generated and gitignored.

## What differs from the local version

- **Known questions** (the 6 examples, the QA topics, the 56 eval questions) answer exactly as the
  local full pipeline did at build time (`mode: "prebuilt"`).
- **Other questions**: keyword ranking (BM25), each hit also scored by vector cosine; the answer gate is
  cosine ≥ 0.75. Eval set: 24 of 41 answerable questions answered (10 from the expected document),
  0 of the 15 no-answer questions. A keyword-only gate managed 18 answered, 4 from the expected document.
- **Semantic mode** (`/api/search?mode=semantic`, MCP `search_law mode=semantic`) ranks by vectors only;
  it also matches English questions to the English Act. Static vectors rank worse than BM25 here
  (hit@1 14 vs 18 of 41), so hybrid keeps the keyword order and uses vectors for the gate.
- **No reranker, no question log, no frequent topics.**
- **PDFs** are fetched from the official site per click (one direct link) and returned inline when
  under 4.4 MB (740 of 805); bigger ones open the official page, which cannot be framed.

## Build, test, deploy

```
# 1. local server running with the reranker (proto/server.py --port 8796), then:
uv run -q --with chromadb --with numpy python proto/build_lite.py
uv run -q --with model2vec --with numpy python proto/potion_probe.py              # section vectors + eval
uv run -q --with model2vec --with numpy --with tokenizers python proto/potion_export.py   # question embedder
rsync -a --exclude data proto/web/dist/ deploy/public/     # after a UI-only change

# 2. try it locally, the way Vercel serves it
uv run -q --with numpy --with tokenizers python proto/hosted_dev.py --port 8799

# 3. deploy
cd deploy && npx vercel deploy --prod --scope <your-team>   # logged in
cd deploy && npx vercel deploy --temporary     # no account: expires in 60 min unless claimed
```

## MCP

Streamable HTTP, stateless, JSON responses: `https://<host>/mcp`.
Tools: `search_law`, `ask_law`, `find_pdf`, `read_ocr`, `corpus_stats`.

```
claude mcp add --transport http craft-beer-excise-web https://thai-excise-law.vercel.app/mcp
```
