#!/usr/bin/env python3
"""TEXT path vs OCR path over the whole excise corpus: extract, embed, compare, visualise.

  uv run --with chromadb --with numpy --with umap-learn python proto/paths.py $EXCISE_CORPUS [stage ...]

stages (default all, in order): text ocr embed compare viz
  text     pdftotext page by page          -> CORPUS/text/<doc>/page_NNNN.txt
  ocr      OCR service (OpenThai, lang th)    -> $OCR_ROOT/<YYYY-MM>/excise-<doc>/page_NNNN.txt
  embed    normalise, chunk (doc+page), embeddinggemma -> ChromaDB collections excise_text / excise_ocr
  compare  per page: char similarity, dropped-ำ words, empty/garbage; retrieval agreement on test questions
  viz      CORPUS/vec/paths.html: 2-D doc map (UMAP) by type and year + per-page quality chart

Every long stage prints progress with ETA. Each stage is resumable (skips finished work).
"""
import difflib
import glob
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from textnorm import normalize, tokens  # noqa: E402
from ingest import chunk_page  # noqa: E402

CORPUS = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("EXCISE_CORPUS", "excise-laws"))
STAGES = sys.argv[2:] or ["text", "ocr", "embed", "compare", "viz"]
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("CHROMA_DIR", os.path.join(HERE, ".chroma"))
OCR_MCP = os.environ.get("OCR_MCP", "http://127.0.0.1:8794/mcp")  # an OCR service speaking MCP
OCR_ROOT = os.path.expanduser(os.environ.get("OCR_ROOT", "~/.ocr"))
ANE = os.environ.get("EMBED_URL", "http://127.0.0.1:11434") + "/api/embed"
MODEL = os.environ.get("EMBED_MODEL", "embeddinggemma")
DOC_P, Q_P = "title: none | text: ", "task: search result | query: "
VEC = os.path.join(CORPUS, "vec")
# words whose ำ the text layer drops when the font has no ToUnicode map (seen on 2141155 p5-7)
DROPPED = re.compile(r"(?:ก|จ|ด|น|ท|ส|ร|ล|ค|ต|ป)[่-๋]?า(?:หนด|นวน|เนิน|เหน็จ|นาจ|รุง|คัญ|นัก|นัญ)")


class Progress:
    def __init__(self, label, total):
        self.label, self.total, self.t0, self.last = label, max(total, 1), time.time(), 0

    def tick(self, done, extra=""):
        now = time.time()
        if done < self.total and now - self.last < 5:
            return
        self.last = now
        el = now - self.t0
        rate = done / el if el else 0
        eta = (self.total - done) / rate if rate else 0
        print(f"  [{self.label}] {100 * done // self.total:3d}%  {done}/{self.total}  {rate:.1f}/s  "
              f"{eta / 60:.1f} min left  ETA {time.strftime('%H:%M:%S', time.localtime(now + eta))} {extra}", flush=True)


def docs():
    seen, out = set(), []
    for line in open(os.path.join(CORPUS, "manifest.jsonl"), encoding="utf-8"):
        r = json.loads(line)
        p = r.get("path")
        if not p or not p.lower().endswith(".pdf") or not os.path.exists(p) or r["doc_id"] in seen:
            continue
        seen.add(r["doc_id"])
        r["key"] = f"{r['law_id']}_{r['doc_id']}"
        out.append(r)
    return out


def ocr_dir(key):
    hits = sorted(glob.glob(os.path.join(OCR_ROOT, "*", f"excise-{key}")))
    return hits[-1] if hits else None


def pages_in(d):
    return {int(re.search(r"(\d+)", os.path.basename(p)).group(1)): p for p in glob.glob(os.path.join(d, "page_*.txt"))} if d else {}


# ---------------------------------------------------------------- text
def stage_text(D):
    pr = Progress("text", len(D))
    for i, r in enumerate(D, 1):
        out = os.path.join(CORPUS, "text", r["key"])
        if not os.path.isdir(out):
            raw = subprocess.run(["pdftotext", "-layout", r["path"], "-"], capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
            os.makedirs(out, exist_ok=True)
            for n, page in enumerate(raw.split("\f"), 1):
                if n == len(raw.split("\f")) and not page.strip():
                    break
                open(os.path.join(out, f"page_{n:04d}.txt"), "w", encoding="utf-8").write(page)
        pr.tick(i)


# ---------------------------------------------------------------- ocr
def mcp(tool, args):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request(OCR_MCP, body, {"Content-Type": "application/json"}), timeout=700))["result"]
    if r.get("isError"):
        raise RuntimeError(r["content"][0]["text"])
    return json.loads(r["content"][0]["text"])


def stage_ocr(D, batch=12):
    todo = [r for r in D if not (ocr_dir(r["key"]) and os.path.exists(os.path.join(ocr_dir(r["key"]), "book.md")))]
    print(f"ocr: {len(D) - len(todo)} done already, {len(todo)} to go", flush=True)
    pr = Progress("ocr docs", len(todo))
    done = 0
    for i in range(0, len(todo), batch):
        ids = []
        for r in todo[i:i + batch]:
            try:
                ids.append(mcp("ocr", {"path": r["path"], "lang": "th", "engine": "openthai", "name": f"excise-{r['key']}", "wait_sec": 0})["id"])
            except Exception as e:
                print(f"  ocr submit failed {r['key']}: {e}", flush=True)
        while ids:
            cur = [mcp("job_get", {"id": j, "wait_sec": 2}) for j in ids]
            for j in cur:
                if j["status"] != "running":
                    ids.remove(j["id"])
                    done += 1
                    if j["status"] != "done":
                        print(f"  ocr {j['name']}: {j['status']}", flush=True)
            pr.tick(done)
    pr.tick(len(todo))


# ---------------------------------------------------------------- embed
def embed(texts, prompt):
    body = json.dumps({"model": MODEL, "input": [prompt + t for t in texts]}).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request(ANE, body, {"Content-Type": "application/json"}), timeout=600))["embeddings"]


def stage_embed(D):
    import chromadb
    client = chromadb.PersistentClient(path=DB)
    for path in ("text", "ocr"):
        col = client.get_or_create_collection(f"excise_{path}", metadata={"hnsw:space": "cosine"})
        have = {m["key"] for m in col.get(include=["metadatas"])["metadatas"]}
        units = []
        for r in D:
            if r["key"] in have:
                continue
            src = os.path.join(CORPUS, "text", r["key"]) if path == "text" else ocr_dir(r["key"])
            for page, p in sorted(pages_in(src).items()):
                for j, c in enumerate(chunk_page(normalize(open(p, encoding="utf-8").read()))):
                    if len(c) >= 20:
                        units.append((f"{r['key']}:p{page}:c{j}", c, {"key": r["key"], "law_id": r["law_id"], "doc_id": r["doc_id"],
                                      "type_id": r["type_id"], "type": r["type"], "year": r["year_be"],
                                      "title": (r.get("title") or "")[:300], "page": page, "chunk": j}))
        print(f"embed {path}: {len(have)} docs already in, {len(units)} new chunks", flush=True)
        pr = Progress(f"embed {path}", len(units))
        for i in range(0, len(units), 64):
            b = units[i:i + 64]
            col.add(ids=[u[0] for u in b], documents=[u[1] for u in b], metadatas=[u[2] for u in b], embeddings=embed([u[1] for u in b], DOC_P))
            pr.tick(min(i + 64, len(units)))


# ---------------------------------------------------------------- compare
def page_quality(D):
    rows = []
    pr = Progress("page compare", len(D))
    for i, r in enumerate(D, 1):
        tp, op = pages_in(os.path.join(CORPUS, "text", r["key"])), pages_in(ocr_dir(r["key"]))
        for page in sorted(set(tp) | set(op)):
            raw_t = open(tp[page], encoding="utf-8").read() if page in tp else ""
            raw_o = open(op[page], encoding="utf-8").read() if page in op else ""
            t, o = normalize(raw_t), normalize(raw_o)
            ts, os_ = re.sub(r"\s+", "", t), re.sub(r"\s+", "", o)
            sim = difflib.SequenceMatcher(None, ts[:4000], os_[:4000], autojunk=False).ratio() if ts and os_ else 0.0
            thai_t = len(re.findall(r"[฀-๿]", ts))
            rows.append({"key": r["key"], "type": r["type"], "year": r["year_be"], "page": page,
                         "text_chars": len(ts), "ocr_chars": len(os_), "sim": round(sim, 3),
                         "dropped_am_text": len(DROPPED.findall(t)), "dropped_am_ocr": len(DROPPED.findall(o)),
                         "decomposed_am_raw": raw_t.count("ํา"),
                         "text_empty": thai_t < 30, "text_garbage": bool(ts) and thai_t / max(len(ts), 1) < 0.3 and len(ts) > 200,
                         "ocr_empty": len(os_) < 30})
        pr.tick(i)
    return rows


def questions(D, n=20, seed=7):
    """Test questions with a known answer document: the subject line of a random document
    (the words after 'เรื่อง'), which a member would plausibly type. Right answer = that document."""
    rnd = random.Random(seed)
    pool = [r for r in D if r.get("title") and "เรื่อง" in r["title"]]
    rnd.shuffle(pool)
    # half the questions from liquor / beer documents, the members' own domain
    pool.sort(key=lambda r: 0 if re.search("สุรา|เบียร์", r["title"]) else 1)
    pool = pool[:n // 2] + [r for r in pool[n // 2:] if not re.search("สุรา|เบียร์", r["title"])]
    out = []
    for r in pool:
        q = normalize(r["title"].split("เรื่อง", 1)[1]).strip()
        q = re.sub(r"\(ฉบับที่.*?\)|พ\.ศ\.\s*\d+", "", q).strip()
        if 12 <= len(q) <= 120 and q not in [x["q"] for x in out]:
            out.append({"q": q, "key": r["key"], "type": r["type"]})
        if len(out) == n:
            break
    return out


def retrieval(D):
    import chromadb
    client = chromadb.PersistentClient(path=DB)
    cols = {p: client.get_collection(f"excise_{p}") for p in ("text", "ocr")}
    Q = questions(D)
    res = []
    for q in Q:
        qv = embed([q["q"]], Q_P)[0]
        row = {"q": q["q"], "want": q["key"], "type": q["type"]}
        top = {}
        for p, col in cols.items():
            r = col.query(query_embeddings=[qv], n_results=5, include=["metadatas", "distances"])
            hits = [(m["key"], m["page"]) for m in r["metadatas"][0]]
            top[p] = hits
            row[f"{p}_rank"] = next((i + 1 for i, h in enumerate(hits) if h[0] == q["key"]), None)
            row[f"{p}_top1"] = f"{hits[0][0]} p{hits[0][1]}" if hits else None
        row["top5_overlap"] = round(len(set(top["text"]) & set(top["ocr"])) / 5, 2)
        res.append(row)
    return res


def stage_compare(D):
    os.makedirs(VEC, exist_ok=True)
    pages = page_quality(D)
    json.dump(pages, open(os.path.join(VEC, "pages.json"), "w"), ensure_ascii=False)
    ret = retrieval(D)
    json.dump(ret, open(os.path.join(VEC, "retrieval.json"), "w"), ensure_ascii=False, indent=1)
    n = len(pages) or 1
    both = [p for p in pages if p["text_chars"] and p["ocr_chars"]]
    summ = {
        "docs": len(D), "pages": len(pages),
        "text_empty_pages": sum(p["text_empty"] for p in pages), "text_garbage_pages": sum(p["text_garbage"] for p in pages),
        "ocr_empty_pages": sum(p["ocr_empty"] for p in pages),
        "pages_with_dropped_am_text": sum(1 for p in pages if p["dropped_am_text"]),
        "dropped_am_words_text": sum(p["dropped_am_text"] for p in pages),
        "dropped_am_words_ocr": sum(p["dropped_am_ocr"] for p in pages),
        "pages_with_decomposed_am_raw": sum(1 for p in pages if p["decomposed_am_raw"]),
        "median_sim_text_vs_ocr": round(float(np.median([p["sim"] for p in both])), 3) if both else None,
        "pages_sim_below_0.8": sum(1 for p in both if p["sim"] < 0.8),
        "questions": len(ret),
        "text_found_top5": sum(1 for r in ret if r["text_rank"]), "ocr_found_top5": sum(1 for r in ret if r["ocr_rank"]),
        "text_found_top1": sum(1 for r in ret if r["text_rank"] == 1), "ocr_found_top1": sum(1 for r in ret if r["ocr_rank"] == 1),
        "mean_top5_overlap": round(float(np.mean([r["top5_overlap"] for r in ret])), 3) if ret else None,
    }
    summ["pct_text_empty_or_garbage"] = round(100 * (summ["text_empty_pages"] + summ["text_garbage_pages"]) / n, 1)
    json.dump(summ, open(os.path.join(VEC, "paths-summary.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(summ, ensure_ascii=False, indent=1), flush=True)


# ---------------------------------------------------------------- viz
def stage_viz(D):
    import chromadb
    import umap
    client = chromadb.PersistentClient(path=DB)
    maps = {}
    for p in ("text", "ocr"):
        got = client.get_collection(f"excise_{p}").get(include=["embeddings", "metadatas"])
        by = {}
        for v, m in zip(got["embeddings"], got["metadatas"]):
            by.setdefault(m["key"], {"m": m, "v": []})["v"].append(np.asarray(v, np.float32))
        keys = sorted(by)
        X = np.stack([np.mean(by[k]["v"], 0) for k in keys])
        X /= np.linalg.norm(X, axis=1, keepdims=True)
        print(f"umap {p}: {len(keys)} docs", flush=True)
        xy = umap.UMAP(n_neighbors=15, min_dist=0.1, metric="cosine", random_state=7).fit_transform(X)
        maps[p] = [{"k": k, "t": by[k]["m"]["title"][:140], "type": by[k]["m"]["type"], "y": by[k]["m"]["year"],
                    "x": round(float(a), 3), "z": round(float(b), 3)} for k, (a, b) in zip(keys, xy)]
    pages = json.load(open(os.path.join(VEC, "pages.json"), encoding="utf-8"))
    summ = json.load(open(os.path.join(VEC, "paths-summary.json"), encoding="utf-8"))
    ret = json.load(open(os.path.join(VEC, "retrieval.json"), encoding="utf-8"))
    html = open(os.path.join(HERE, "paths_viz.html"), encoding="utf-8").read()
    for k, v in {"__MAPS__": maps, "__PAGES__": [[p["sim"], p["text_empty"], p["text_garbage"], p["dropped_am_text"], p["type"], p["key"], p["page"]] for p in pages],
                 "__SUMM__": summ, "__RET__": ret}.items():
        html = html.replace(k, json.dumps(v, ensure_ascii=False))
    out = os.path.join(VEC, "paths.html")
    open(out, "w", encoding="utf-8").write(html)
    print("viz:", out, flush=True)


def main():
    D = docs()
    print(f"corpus: {len(D)} PDFs in {CORPUS}; stages {STAGES}", flush=True)
    for s in STAGES:
        t0 = time.time()
        print(f"== {s}", flush=True)
        globals()[f"stage_{s}"](D)
        print(f"== {s} done in {(time.time() - t0) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
