#!/usr/bin/env python3
"""Ingest OCR'd excise pages into ChromaDB.

  uv run --with chromadb --with numpy proto/ingest.py [DOC_DIR ...]

DOC_DIR holds page_0001.txt ... (one OCR text file per PDF page) and
optionally doc.json {"doc_id", "title", "source_url", "gazette"}. Every chunk keeps
doc_id + page so an answer can cite where it came from.
"""
import glob
import json
import os
import re
import sys
import urllib.request

import chromadb

sys.path.insert(0, os.path.dirname(__file__))
from textnorm import normalize  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("CHROMA_DIR", os.path.join(HERE, ".chroma"))
ANE = os.environ.get("EMBED_URL", "http://127.0.0.1:11434")  # any Ollama-compatible /api/embed
MODEL = os.environ.get("EMBED_MODEL", "embeddinggemma")
DOC_PROMPT = "title: none | text: "
COLLECTION = "excise"
CHUNK, OVERLAP = 600, 120                   # characters; Thai has no spaces between words


def embed(texts, prompt):
    body = json.dumps({"model": MODEL, "input": [prompt + t for t in texts]}).encode()
    req = urllib.request.Request(f"{ANE}/api/embed", data=body, headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=300))["embeddings"]


def chunk_page(text):
    """Split on lines, pack lines into ~CHUNK-char windows with OVERLAP carried over."""
    lines = [ln for ln in text.split("\n") if ln.strip()]
    chunks, cur = [], ""
    for ln in lines:
        if cur and len(cur) + len(ln) + 1 > CHUNK:
            chunks.append(cur)
            cur = cur[-OVERLAP:] if OVERLAP else ""
            cur = cur[cur.find("\n") + 1:] if "\n" in cur else cur
        cur = f"{cur}\n{ln}" if cur else ln
    if cur:
        chunks.append(cur)
    return chunks


def doc_meta(doc_dir, first_page):
    path = os.path.join(doc_dir, "doc.json")
    meta = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    meta.setdefault("doc_id", os.path.basename(os.path.normpath(doc_dir)))
    if "title" not in meta:
        lines = first_page.split("\n")
        head = [i for i, ln in enumerate(lines) if ln.startswith(("ประกาศ", "กฎกระทรวง", "พระราชบัญญัติ", "ระเบียบ", "คำสั่ง"))]
        if head:
            i = head[0]
            meta["title"] = " ".join(lines[i:i + 2 if lines[i + 1:i + 2] and lines[i + 1].startswith("เรื่อง") else i + 1])
            meta["title"] = re.sub(r"\s+", " ", meta["title"])[:200]
        else:
            meta["title"] = meta["doc_id"]
    if "gazette" not in meta:
        m = re.search(r"เล่ม\s*(\d+)\s*ตอน(?:พิเศษ)?\s*(\d+\s*\S?)\s*ราชกิจจานุเบกษา\s*(\d+\s*\S+\s*\d+)", first_page)
        meta["gazette"] = f"ราชกิจจานุเบกษา เล่ม {m.group(1)} ตอน {m.group(2).strip()} ({m.group(3)})" if m else ""
    return meta


def ingest(doc_dir, col):
    pages = sorted(glob.glob(os.path.join(doc_dir, "page_*.txt")))
    if not pages:
        print(f"skip {doc_dir}: no page_*.txt")
        return 0
    texts = [normalize(open(p, encoding="utf-8").read()) for p in pages]
    meta = doc_meta(doc_dir, texts[0])
    ids, docs, metas = [], [], []
    for p, text in zip(pages, texts):
        page = int(re.search(r"(\d+)", os.path.basename(p)).group(1))
        for j, c in enumerate(chunk_page(text)):
            ids.append(f"{meta['doc_id']}:p{page}:c{j}")
            docs.append(c)
            metas.append({"doc_id": meta["doc_id"], "title": meta["title"], "page": page, "chunk": j,
                          "gazette": meta.get("gazette", ""), "source_url": meta.get("source_url", "")})
    col.delete(where={"doc_id": meta["doc_id"]})
    vecs = []
    for i in range(0, len(docs), 32):
        vecs.extend(embed(docs[i:i + 32], DOC_PROMPT))
    col.add(ids=ids, documents=docs, metadatas=metas, embeddings=vecs)
    print(f"{meta['doc_id']}: {len(pages)} pages, {len(docs)} chunks, title={meta['title'][:70]!r}, {meta.get('gazette','')}")
    return len(docs)


def main():
    dirs = sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, "data", "*")))
    client = chromadb.PersistentClient(path=DB)
    col = client.get_or_create_collection(COLLECTION, metadata={"hnsw:space": "cosine"})
    total = sum(ingest(d, col) for d in dirs if os.path.isdir(d))
    print(f"total chunks in '{COLLECTION}': {col.count()} (added {total}) at {DB}")


if __name__ == "__main__":
    main()
