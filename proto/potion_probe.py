#!/usr/bin/env python3
"""Static (model2vec) vectors for the hosted build: embed every section, then score on the eval set.

  uv run -q --with model2vec --with numpy python proto/potion_probe.py [model]

Writes deploy/data/vec.npy (float16, unit length) and deploy/data/vec_model.json, and prints
document-level hit@1/5 and MRR for keyword only, vectors only and the two fused (RRF), using the
same search code the hosted function runs.
"""
import gzip
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "deploy", "data")
MODEL = sys.argv[1] if len(sys.argv) > 1 else "minishlab/potion-multilingual-128M"


def main():
    from model2vec import StaticModel
    t = time.time()
    m = StaticModel.from_pretrained(MODEL)
    print(f"model {MODEL}: dim {m.dim}, vocab {len(m.tokens)}, load {time.time() - t:.1f}s", flush=True)
    with gzip.open(os.path.join(OUT, "sections.json.gz"), "rt", encoding="utf-8") as f:
        s = json.load(f)
    t = time.time()
    v = m.encode([(x.get("title", "") + "\n" + d)[:4000] for x, d in zip(s["metas"], s["docs"])], show_progress_bar=False)
    v = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
    print(f"{len(v)} sections embedded in {time.time() - t:.1f}s", flush=True)
    np.save(os.path.join(OUT, "vec.npy"), v.astype(np.float16))
    json.dump({"model": MODEL, "dim": int(m.dim)}, open(os.path.join(OUT, "vec_model.json"), "w"))

    sys.path.insert(0, os.path.join(os.path.dirname(HERE), "deploy", "api"))
    import index
    ix = index.Lite()
    qs = [q for q in json.load(open(os.path.join(HERE, "eval", "questions.json"), encoding="utf-8")) if q.get("answerable")]

    def good(q, mt):
        keys = set(q.get("keys") or []) | ({q["key"]} if q.get("key") else set())
        return mt.get("key") in keys or (q.get("accept_title") and q["accept_title"] in (mt.get("title") or ""))

    def score(name, rank_fn):
        h1 = h5 = 0
        mrr = 0.0
        for q in qs:
            seen, rank = [], None
            for i in rank_fn(q["q"]):
                k = ix.metas[i].get("key")
                if k in seen:
                    continue
                seen.append(k)
                if good(q, ix.metas[i]):
                    rank = len(seen)
                    break
            if rank:
                h1 += rank == 1
                h5 += rank <= 5
                mrr += 1 / rank
        print(f"{name:9} hit@1 {h1:2d}/{len(qs)}  hit@5 {h5:2d}/{len(qs)}  MRR {mrr / len(qs):.3f}", flush=True)

    from terms import expand
    from textnorm import normalize

    def kw(q):
        return [i for _, i, _ in ix.bm25(expand(normalize(q))[0], 60)]

    def sem(q):
        qv = m.encode([expand(normalize(q))[0]])[0]
        qv = qv / (np.linalg.norm(qv) or 1)
        return list(np.argsort(-(v @ qv))[:60])

    def fused(q):
        acc = {}
        for r, i in enumerate(kw(q)):
            acc[i] = acc.get(i, 0) + 1 / (61 + r)
        for r, i in enumerate(sem(q)):
            acc[i] = acc.get(i, 0) + 1 / (61 + r)
        return sorted(acc, key=lambda i: -acc[i])

    score("keyword", kw)
    score("vectors", sem)
    score("hybrid", fused)


if __name__ == "__main__":
    main()
