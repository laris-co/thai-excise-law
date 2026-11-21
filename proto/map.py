#!/usr/bin/env python3
"""2-D map of every section vector, for the search explorer (/#/map).

  uv run --with chromadb --with numpy --with umap-learn python proto/map.py [collection]

Reads the prebuilt embeddings of one ChromaDB collection (default excise_sec), projects
them to 2-D with UMAP (cosine, n_neighbors 15) and writes proto/.map/<collection>.json:
  {"collection", "n", "ids": [...], "xy": [[x, y], ...]}  coordinates scaled to 0..1000.
The server joins it with the chunk metadata. Rebuild after sections.py re-indexes.
"""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("CHROMA_DIR", os.path.join(HERE, ".chroma"))
OUT = os.path.join(HERE, ".map")


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "excise_sec"
    import chromadb
    import umap

    t0 = time.time()
    col = chromadb.PersistentClient(path=DB).get_collection(name)
    got = col.get(include=["embeddings"])
    ids, emb = got["ids"], np.asarray(got["embeddings"], dtype=np.float32)
    print(f"{name}: {len(ids)} vectors x {emb.shape[1]} dims, read in {time.time() - t0:.1f}s", flush=True)
    t1 = time.time()
    xy = umap.UMAP(n_neighbors=15, min_dist=0.08, metric="cosine", random_state=7, verbose=True).fit_transform(emb)
    print(f"umap {time.time() - t1:.1f}s", flush=True)
    lo, hi = xy.min(0), xy.max(0)
    xy = (xy - lo) / np.where(hi - lo == 0, 1, hi - lo) * 1000
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"collection": name, "n": len(ids), "ids": ids, "xy": [[round(float(a), 1), round(float(b), 1)] for a, b in xy]}, f)
    print(f"wrote {path} ({os.path.getsize(path) // 1024} KB) in {time.time() - t0:.1f}s total", flush=True)


if __name__ == "__main__":
    main()
