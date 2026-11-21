#!/usr/bin/env python3
"""Shrink the static embedding model so the hosted function can embed questions itself.

  uv run -q --with model2vec --with numpy --with tokenizers python proto/potion_export.py

potion-multilingual-128M is a 500k x 256 table (512 MB float32) plus the bge-m3 tokenizer.
A question is embedded by looking up its tokens' rows and averaging them, so the function only
needs the rows a Thai or English question can produce: tokens written in Thai, Latin or digits.
Those rows are kept, quantised to int8 with one scale per row.

Writes deploy/data/emb.npz (rows, scale, idmap) and deploy/data/tokenizer.json, then checks the
shrunk model against the full one on the eval questions (cosine of the two question vectors).
"""
import json
import os
import re
import shutil

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "deploy", "data")
MODEL = json.load(open(os.path.join(OUT, "vec_model.json")))["model"]
KEEP = re.compile(r"^[฀-๿ -~ -ÿ▁]+$")  # Thai, ASCII, Latin-1, the ▁ word mark


def main():
    from model2vec import StaticModel
    from huggingface_hub import snapshot_download
    m = StaticModel.from_pretrained(MODEL)
    E = np.asarray(m.embedding, dtype=np.float32)
    vocab = m.tokenizer.get_vocab()  # token -> id
    keep = sorted(i for t, i in vocab.items() if KEEP.match(t))
    print(f"vocab {len(vocab)}, kept {len(keep)} rows ({len(keep) / len(vocab):.0%})")
    rows = E[keep]
    scale = np.abs(rows).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.round(rows / scale[:, None]).astype(np.int8)
    idmap = np.full(E.shape[0], -1, dtype=np.int32)
    idmap[keep] = np.arange(len(keep), dtype=np.int32)
    np.savez_compressed(os.path.join(OUT, "emb.npz"), rows=q, scale=scale.astype(np.float16), idmap=idmap)
    shutil.copy(os.path.join(snapshot_download(MODEL), "tokenizer.json"), os.path.join(OUT, "tokenizer.json"))
    unk = m.unk_token_id
    json.dump({"model": MODEL, "dim": int(m.dim), "unk": unk}, open(os.path.join(OUT, "vec_model.json"), "w"))

    from tokenizers import Tokenizer
    tok = Tokenizer.from_file(os.path.join(OUT, "tokenizer.json"))
    deq = q.astype(np.float32) * scale[:, None]

    def small(text):
        ids = [i for i in tok.encode(text, add_special_tokens=False).ids if i != unk and idmap[i] >= 0]
        if not ids:
            return np.zeros(m.dim, dtype=np.float32)
        v = deq[idmap[ids]].mean(axis=0)
        return v / (np.linalg.norm(v) or 1)

    qs = [x["q"] for x in json.load(open(os.path.join(HERE, "eval", "questions.json"), encoding="utf-8"))]
    qs += ["What is the excise tax on beer?", "license fee for a small brewery", "ใบอนุญาต brewpub ต้องใช้อะไร"]
    sims = [float(small(x) @ m.encode([x])[0]) for x in qs]
    print(f"shrunk vs full, {len(qs)} questions: min cosine {min(sims):.4f}, mean {np.mean(sims):.4f}")
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in ("emb.npz", "tokenizer.json"))
    print(f"emb.npz + tokenizer.json = {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
