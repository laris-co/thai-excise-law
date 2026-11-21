#!/usr/bin/env python3
"""Prebuild everything the hosted (Vercel, free tier) version needs, into deploy/.

  uv run -q --with chromadb --with numpy python proto/build_lite.py

The hosted version cannot run ChromaDB, the embedding model or the reranker, so this script
does that work here, once, and writes plain files:

  deploy/data/sections.json.gz   every section: id, text, metadata (+ dates and PDF link)
  deploy/data/postings.npz       BM25 inverted index over Thai trigrams (numpy arrays)
  deploy/data/vocab.json         token -> [offset, count, idf]
  deploy/data/prebuilt.json      full-pipeline answers (vectors + reranker) for known questions
  deploy/data/pdfsize.json       PDF size per doc, so the proxy knows which fit a function reply
  deploy/public/                 the web UI build, plus data/doc/<key>.json and data/map.json

Needs the local server (proto/server.py, reranker on) at CRAFT_API for the docs, the map and
the prebuilt answers.
"""
import gzip
import json
import math
import os
import shutil
import sys
import time
import urllib.request
from collections import Counter

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "deploy")
API = os.environ.get("CRAFT_API", "http://127.0.0.1:8796")
sys.path.insert(0, HERE)
from server import manifest, DB, COLLECTION  # noqa: E402
from textnorm import normalize, tokens  # noqa: E402

EXAMPLES = [  # the example questions on the first page (App.jsx) and the QA-report topics
    "เปิดโรงเบียร์ขนาดเล็กต้องขออนุญาตอะไรบ้าง",
    "อัตราภาษีเบียร์ตอนนี้เท่าไร",
    "ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม",
    "ค่าธรรมเนียมใบอนุญาตผลิตเบียร์เท่าไร",
    "ต้องขออนุมัติฉลากเบียร์ก่อนขายไหม",
    "ต้องปิดแสตมป์สุราให้หมดในครั้งเดียวไหม",
    "ยื่นภาษีทางอินเทอร์เน็ตต้องใช้แบบอะไร",
    "นำเข้าเบียร์ต้องขอใบอนุญาตอะไร",
    "ขายเบียร์ต้องมีใบอนุญาตขายสุราประเภทไหน",
    # the topic cards on the first page (Front.jsx TOPICS)
    "ต้องยื่นต่ออายุใบอนุญาตผลิตเบียร์ก่อนหมดอายุกี่วัน",
    "ขนเบียร์ออกจากโรงงานต้องมีเอกสารอะไร",
    "ผลิตเบียร์โดยไม่มีใบอนุญาตมีโทษอะไร",
]
from eval_api import QA  # noqa: E402  the QA-report questions answer from the full pipeline too
EXAMPLES += [q for q, _, _ in QA if q not in EXAMPLES]


def get(path):
    return json.load(urllib.request.urlopen(API + path, timeout=120))


def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=300))


def step(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    import chromadb
    os.makedirs(os.path.join(OUT, "data"), exist_ok=True)
    pub = os.path.join(OUT, "public")
    if os.path.isdir(pub):
        shutil.rmtree(pub)

    step("sections from ChromaDB")
    col = chromadb.PersistentClient(path=DB).get_collection(COLLECTION)
    got = col.get(include=["documents", "metadatas"])
    urls, dates = manifest()
    metas = []
    for m in got["metadatas"]:
        m = dict(m)
        if not m.get("source_url") and urls.get(m.get("doc_id")):
            m["source_url"] = urls[m["doc_id"]]
        d = dates.get(m.get("key"), {})
        m["effect"], m["cancel"] = d.get("effect", ""), d.get("cancel", "")
        metas.append(m)
    import relations  # who repealed / amended whom, from the documents' own text
    relations.apply(metas, relations.relations(got["ids"], got["documents"], metas, time.strftime("%Y-%m-%d")))
    with gzip.open(os.path.join(OUT, "data", "sections.json.gz"), "wt", encoding="utf-8") as f:
        json.dump({"collection": COLLECTION, "ids": got["ids"], "docs": got["documents"], "metas": metas}, f, ensure_ascii=False)

    step(f"BM25 index over {len(got['ids'])} sections")
    toks = [Counter(tokens(d)) for d in got["documents"]]
    lens = np.array([sum(t.values()) for t in toks], dtype=np.float32)
    post_ = {}
    for i, tf in enumerate(toks):
        for w, c in tf.items():
            post_.setdefault(w, []).append((i, c))
    n = len(toks)
    vocab, ids, tfs, off = {}, [], [], 0
    for w, p in post_.items():
        vocab[w] = [off, len(p), round(math.log(1 + (n - len(p) + 0.5) / (len(p) + 0.5)), 6)]
        ids.extend(i for i, _ in p)
        tfs.extend(min(c, 65535) for _, c in p)
        off += len(p)
    np.savez_compressed(os.path.join(OUT, "data", "postings.npz"), ids=np.array(ids, dtype=np.int32),
                        tf=np.array(tfs, dtype=np.uint16), lens=lens)
    json.dump(vocab, open(os.path.join(OUT, "data", "vocab.json"), "w", encoding="utf-8"), ensure_ascii=False)
    step(f"  {len(vocab)} tokens, {off} postings")

    step("PDF sizes")
    sizes = {k: os.path.getsize(d["path"]) for k, d in dates.items() if d.get("path") and os.path.isfile(d["path"])}
    json.dump(sizes, open(os.path.join(OUT, "data", "pdfsize.json"), "w"))

    step("web UI build")
    shutil.copytree(os.path.join(HERE, "web", "dist"), pub)
    os.makedirs(os.path.join(pub, "data", "doc"), exist_ok=True)

    keys = sorted({m.get("key") for m in metas if m.get("key")})
    step(f"reader text for {len(keys)} documents")
    for j, k in enumerate(keys):
        d = get(f"/api/doc?key={k}")
        d["pdf_local"] = sizes.get(k, 0) > 0 and sizes[k] <= 4_400_000  # the hosted PDF proxy can return this one inline
        with open(os.path.join(pub, "data", "doc", f"{k}.json"), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        if j % 100 == 0:
            step(f"  {j}/{len(keys)}")

    step("OCR quality scores (review queue)")
    qp = os.path.join(os.path.dirname(os.path.expanduser(os.environ.get("EXCISE_MANIFEST", os.path.join(os.environ.get("EXCISE_CORPUS", "excise-laws"), "manifest.jsonl")))),
                      "vec", "ocr_quality.json")
    if os.path.exists(qp):
        shutil.copy(qp, os.path.join(pub, "data", "ocr_quality.json"))

    step("map")
    json.dump(get("/api/map"), open(os.path.join(pub, "data", "map.json"), "w", encoding="utf-8"), ensure_ascii=False,
              separators=(",", ":"))

    step("prebuilt answers (full pipeline: vectors + reranker)")
    qs = list(EXAMPLES)
    for q in json.load(open(os.path.join(HERE, "eval", "questions.json"), encoding="utf-8")):
        if q["q"] not in qs:
            qs.append(q["q"])
    pre = {}
    for j, q in enumerate(qs):
        r = post("/api/chat", {"q": q, "src": "test"})
        r["prebuilt"] = True
        pre[normalize(q)] = r
        if j % 10 == 0:
            step(f"  {j}/{len(qs)}")
    json.dump(pre, open(os.path.join(OUT, "data", "prebuilt.json"), "w", encoding="utf-8"), ensure_ascii=False)

    for f in ("textnorm.py", "terms.py", "relations.py"):
        os.makedirs(os.path.join(OUT, "api", "_lib"), exist_ok=True)
        shutil.copy(os.path.join(HERE, f), os.path.join(OUT, "api", "_lib", f))
    step("done")
    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(OUT) for f in fs)
    step(f"deploy/ is {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
