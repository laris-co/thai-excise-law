#!/usr/bin/env python3
"""Local chatbot API + static web UI. Binds 127.0.0.1 only.

  uv run --with chromadb --with numpy proto/server.py [--port 8796]

GET  /api/health                 chunk count, embed service status
GET  /api/search?q=...&k=8&mode=hybrid|semantic|keyword   BM25 + semantic fused by RRF (+ rerank), or one of them
GET  /api/docs?q=...&k=10        find documents (PDFs) by title words, newest in force first
GET  /api/doc?key=<law>_<doc>      full OCR text by page + section list (the reader)
GET  /api/doc.md?key=<law>_<doc>   the same document as markdown (citation header + OCR pages)
GET  /api/pdf?key=<law>_<doc>      the original PDF from the local corpus copy (inline, for the reader)
GET  /api/terms?q=...              legal words the search would add (live hint under the question box)
GET  /api/popular?k=8&days=0&test=0  frequent topics: logged questions grouped by meaning, answer rate
GET  /api/map                      every section as a 2-D point (proto/map.py UMAP) + metadata
GET  /api/trace?q=...              one question through every stage (bm25, semantic, fused, rerank, gate)
POST /api/chat {"q": "..."}      answer ONLY from retrieved chunks, each with doc + page citation
                                   {"compare": true} also returns "base": the same question without the reranker
GET  /                           proto/web/dist (React + Tailwind build)

There is no generative model here on purpose: the answer is the retrieved passages,
quoted with their citations. When nothing relevant is found the bot says so instead
of guessing (an LLM alone is "50/50" on law questions). A generator can be plugged in
later on top of the same /api/search (features.md D).
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.request
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import chromadb

sys.path.insert(0, os.path.dirname(__file__))
from terms import expand  # noqa: E402
from textnorm import normalize, tokens  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("CHROMA_DIR", os.path.join(HERE, ".chroma"))
DIST = os.path.join(HERE, "web", "dist")
ANE = os.environ.get("EMBED_URL", "http://127.0.0.1:11434")  # any Ollama-compatible /api/embed
MODEL = os.environ.get("EMBED_MODEL", "embeddinggemma")
QUERY_PROMPT = "task: search result | query: "
RRF_K = 60
MIN_COSINE = 0.45      # below this a semantic-only hit is treated as "not relevant"
MIN_BM25_SHARE = 0.20  # a BM25-only hit must match at least this share of query tokens
COLLECTION = os.environ.get("CHROMA_COLLECTION", "excise_sec")  # one chunk per ข้อ/มาตรา (sections.py); excise_ocr = page windows
MANIFEST = os.path.expanduser(os.environ.get("EXCISE_MANIFEST", os.path.join(os.environ.get("EXCISE_CORPUS", "excise-laws"), "manifest.jsonl")))
# answer gate (tuned by eval_chunks.py); a passage counts when both methods agree or one is strong
GATE = {"cos_only": 0.6, "agree_cos": 0.55, "agree_match": 0.5, "kw_match": 0.8, "kw_cos": 0.3, "match_key": "match_q"}  # 2026-11-20 sweep on excise_sec, 56 q: 28 right, 10 other doc, 3 silent, 0 of 15 false; margin 0.073


RERANK_N = 20
GUIDE_MIN = 0.25  # the highlighted span must itself read as an answer, not just be the least bad
# gate when the reranker is on: one threshold on its score (eval_chunks.py sweep)
RERANK_GATE = {"rerank": 0.5}  # 2026-11-20 sweep, 56 q: 30 right, 11 other doc, 0 refused, 0 of 15 false; top negative 0.24


def strong(h, g=GATE):
    if "rerank" in g:
        return h.get("rerank", 0) >= g["rerank"]
    # match_key "match_q" = share of the member's own words (before terms.py) found in the passage
    cos, match = h.get("cosine", 0), h.get(g.get("match_key", "match")) or 0
    return (match >= g["kw_match"] and cos >= g["kw_cos"]) or (cos >= g["agree_cos"] and match >= g["agree_match"]) or cos >= g["cos_only"]


def spans(text, lo=60, hi=320):
    """Cut a section into sentence-sized spans (char offsets) for the guide highlight.
    Thai law text has no full stops: lines first, long lines at spaces, short bits merged on."""
    out = []
    for m in re.finditer(r"[^\n]+", text):
        a, b = m.start(), m.end()
        while b - a > hi:
            cut = text.rfind(" ", a + lo, a + hi)
            if cut <= a:
                cut = a + hi
            out.append([a, cut])
            a = cut + 1
        out.append([a, b])
    merged = []
    for a, b in out:
        if text[a:b].strip() == "":
            continue
        if merged and (b - a < lo or merged[-1][1] - merged[-1][0] < lo) and b - merged[-1][0] <= hi:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return merged


NONBEER = re.compile(r"(?:มิใช่|ไม่ใช่)สุราแช่ชนิดเบียร์")
ASKS_IMPORT = re.compile(r"นำเข้า|หิ้ว|ติดตัว|ต่างประเทศ|import|ราชอาณาจักร", re.I)
NOT_BEER_Q = re.compile(r"(?:ไม่ใช่|มิใช่|นอกจาก)(?:สุราแช่)?(?:ชนิด)?เบียร์")  # "สุราแช่ที่ไม่ใช่เบียร์" asks about the others
ASKS_BEER = re.compile(r"เบียร์|\bbeers?\b|brew", re.I)


def non_beer(title, text):
    """A section only about drinks other than beer: its title says so, or its text names beer only
    as "สุราแช่ที่มิใช่สุราแช่ชนิดเบียร์" (QA 2026-11-21: horsepower caps quoted from the non-beer rule)."""
    if NONBEER.search(title or ""):
        return True
    rest = NONBEER.sub("", text or "")
    return bool(NONBEER.search(text or "")) and "ชนิดเบียร์" not in rest


def family(title):
    """One law and its amendments share a family: the title without "(ฉบับที่ N)" and the year."""
    t = normalize(title or "")
    t = re.sub(r"\(\s*ฉบับที่[^)]*\)|พ\.ศ\.\s*\d{4}|\d{4}\s*$|\(update[^)]*\)", "", t)
    return re.sub(r"\s+", "", t)


def manifest():
    """doc_id -> lawelcs PDF link (OCR-path citations open the original), plus dates per doc."""
    urls, dates = {}, {}
    if os.path.exists(MANIFEST):
        for line in open(MANIFEST, encoding="utf-8"):
            r = json.loads(line)
            urls.setdefault(r["doc_id"], r.get("url"))
            dates[f"{r['law_id']}_{r['doc_id']}"] = {"effect": (r.get("effect_date") or "")[:10],
                                                     "cancel": (r.get("cancel_date") or "")[:10], "path": r.get("path") or ""}
    return urls, dates


class Index:
    def __init__(self, collection=COLLECTION, expand_terms=True, newest_first=True, reranker=None):
        self.name = collection
        self.expand_terms, self.newest_first = expand_terms, newest_first
        self.reranker, self.rerank_query = reranker, "expanded"  # the reranker reads the question with the legal terms added
        self.col = chromadb.PersistentClient(path=DB).get_or_create_collection(collection, metadata={"hnsw:space": "cosine"})
        self.urls, self.dates = manifest()
        self.reload()

    def reload(self):
        got = self.col.get(include=["documents", "metadatas"])
        self.ids, self.docs, self.metas = got["ids"], got["documents"], got["metadatas"]
        for m in self.metas:
            if not m.get("source_url") and self.urls.get(m.get("doc_id")):
                m["source_url"] = self.urls[m["doc_id"]]
            d = self.dates.get(m.get("key"), {})
            m["effect"], m["cancel"] = d.get("effect", ""), d.get("cancel", "")
        # who repealed / amended whom, read from the documents' own "ให้ยกเลิก" clauses (relations.py)
        import relations
        relations.apply(self.metas, relations.relations(self.ids, self.docs, self.metas, time.strftime("%Y-%m-%d")))
        self.toks = [Counter(tokens(d)) for d in self.docs]
        self.post = {}  # inverted index: token -> [(chunk, tf)], so BM25 touches only matching chunks
        for i, tf in enumerate(self.toks):
            for w, f in tf.items():
                self.post.setdefault(w, []).append((i, f))
        self.lens = [sum(t.values()) for t in self.toks]
        self.avg = (sum(self.lens) / len(self.lens)) if self.lens else 1
        df = Counter()
        for t in self.toks:
            df.update(t.keys())
        n = len(self.docs)
        self.idf = {w: math.log(1 + (n - c + 0.5) / (c + 0.5)) for w, c in df.items()}
        self.pos = {cid: i for i, cid in enumerate(self.ids)}

    def bm25(self, q, k):
        qt = set(tokens(q))
        if not qt:
            return []
        acc = {}
        for w in qt:
            idf = self.idf.get(w, 0)
            for i, f in self.post.get(w, ()):
                a = acc.setdefault(i, [0.0, 0])
                a[0] += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * self.lens[i] / self.avg))
                a[1] += 1
        scored = [(s, i, hit / len(qt)) for i, (s, hit) in acc.items() if hit / len(qt) >= MIN_BM25_SHARE]
        scored.sort(reverse=True)
        return scored[:k]

    def qvec(self, q):
        body = json.dumps({"model": MODEL, "input": [QUERY_PROMPT + q]}).encode()
        req = urllib.request.Request(f"{ANE}/api/embed", data=body, headers={"Content-Type": "application/json"})
        return json.load(urllib.request.urlopen(req, timeout=60))["embeddings"][0]

    def semantic(self, vec, k):
        res = self.col.query(query_embeddings=[vec], n_results=min(k, len(self.ids) or 1))
        return [(1 - d, self.pos[cid]) for cid, d in zip(res["ids"][0], res["distances"][0]) if cid in self.pos]

    def cosines(self, vec, idx):
        """cosine for keyword-only hits too, so the gate sees both signals on every passage"""
        if not idx:
            return {}
        got = self.col.get(ids=[self.ids[i] for i in idx], include=["embeddings"])
        qn = math.sqrt(sum(x * x for x in vec)) or 1
        out = {}
        for cid, e in zip(got["ids"], got["embeddings"]):
            en = math.sqrt(sum(float(x) * float(x) for x in e)) or 1
            out[self.pos[cid]] = sum(float(a) * float(b) for a, b in zip(vec, e)) / (qn * en)
        return out

    def search(self, q, k=8, rerank=True, trace=None, mode="hybrid"):
        """rerank=False skips the cross-encoder for this call (the base path, for compare).
        trace: a dict to fill with every stage (for the search explorer)."""
        rr = self.reranker if rerank else None
        T = time.time()
        # mode: hybrid (BM25 + vectors, the chatbot), semantic (vectors only), keyword (BM25 only)
        q = normalize(q)
        asked = q
        added = []
        if self.expand_terms:
            q, added = expand(q)
        lex = self.bm25(q, k * 3) if mode != "semantic" else []
        if trace is not None:
            trace["tokens"] = list(dict.fromkeys(tokens(q)))  # question order
            trace["tokens_known"] = sum(1 for w in trace["tokens"] if w in self.idf)
            trace["bm25"] = [{"id": self.ids[i], "score": round(s, 2), "share": round(sh, 2)} for s, i, sh in lex]
            trace["ms_bm25"] = round((time.time() - T) * 1000)
        vec = None
        try:
            if mode == "keyword":
                raise LookupError("keyword mode: no vector search")
            vec = self.qvec(q)
            sem = self.semantic(vec, k * 3)
            sem_err = None
            if trace is not None:
                trace["qvec"], trace["dims"] = [round(float(x), 4) for x in vec[:8]], len(vec)
        except LookupError:
            sem, sem_err = [], None
        except Exception as e:  # embed service down: keyword search still works
            sem, sem_err = [], str(e)
        fused = {}
        for rank, (s, i, share) in enumerate(lex):
            f = fused.setdefault(i, {"rrf": 0.0})
            f["rrf"] += 1 / (RRF_K + rank + 1)
            f.update(bm25=round(s, 3), bm25_rank=rank + 1, match=round(share, 2))
        for rank, (cos, i) in enumerate(sem):
            if cos < MIN_COSINE and i not in fused and mode != "semantic":
                continue
            f = fused.setdefault(i, {"rrf": 0.0})
            f["rrf"] += 1 / (RRF_K + rank + 1)
            f.update(cosine=round(cos, 3), sem_rank=rank + 1)
        ranked = sorted(fused.items(), key=lambda kv: -kv[1]["rrf"])
        if trace is not None:
            trace["semantic"] = [{"id": self.ids[i], "cos": round(c, 3), "kept": c >= MIN_COSINE or i in fused} for c, i in sem]
            trace["fused"] = [{"id": self.ids[i], "rrf": round(f["rrf"], 5)} for i, f in ranked]
            trace["ms_fused"] = round((time.time() - T) * 1000)
        if rr is not None:
            from rerank import passage
            cand = self.versions(ranked[:RERANK_N * 2])[:RERANK_N]
            t0 = time.time()
            rq = asked if self.rerank_query == "asked" else q
            scores = rr.score(rq, [passage({**self.metas[i], "text": self.docs[i]}) for i, _ in cand])
            for (i, f), sc in zip(cand, scores):
                f["rerank"] = round(sc, 4)
            self.last_rerank_s = time.time() - t0
            top = self.versions(sorted(cand, key=lambda x: -x[1]["rerank"]))[:k]
            if trace is not None:
                trace["rerank"] = [{"id": self.ids[i], "score": f["rerank"]} for i, f in sorted(cand, key=lambda x: -x[1]["rerank"])]
                trace["ms_rerank"] = round(self.last_rerank_s * 1000)
        else:
            top = self.versions(ranked[:k * 2])[:k]
        import relations
        for i, f in top:
            f["applies_to"] = relations.applies_to(self.metas[i].get("title"), self.docs[i])
        if not ASKS_IMPORT.search(q):  # not an import question: rules only about importing go last
            top = [x for x in top if "นำเข้า" not in x[1]["applies_to"]] + [x for x in top if "นำเข้า" in x[1]["applies_to"]]
        if ASKS_BEER.search(asked) and not NOT_BEER_Q.search(asked):  # a beer question: other-drink-only sections go last
            for i, f in top:
                if non_beer(self.metas[i].get("title"), self.docs[i]):
                    f["non_beer"] = True
            top = [x for x in top if not x[1].get("non_beer")] + [x for x in top if x[1].get("non_beer")]
        qt0 = set(tokens(asked))
        for i, f in top:
            f["match_q"] = round(sum(1 for w in qt0 if w in self.toks[i]) / len(qt0), 2) if qt0 else 0
        if vec is not None:
            extra = self.cosines(vec, [i for i, f in top if "cosine" not in f])
            for i, f in top:
                if i in extra:
                    f["cosine"] = round(extra[i], 3)
        hits = [{"id": self.ids[i], "text": self.docs[i], **self.metas[i], **{kk: v for kk, v in f.items()},
                 "via": "+".join(x for x in ("bm25", "semantic") if (x == "bm25" and "bm25" in f) or (x == "semantic" and "sem_rank" in f))}
                for i, f in top]
        for h in hits:
            h["rrf"] = round(h["rrf"], 5)
            sec = f" {h['section']}" if h.get("section") else ""
            h["cite"] = f"{h['title']}{sec} หน้า {h.get('pages') or h['page']}" + (f" · {h['gazette']}" if h.get("gazette") else "")
        if trace is not None:
            trace["final"] = [h["id"] for h in hits]
            trace["ms"] = round((time.time() - T) * 1000)
        return {"query": asked, "expanded": added, "hits": hits, "semantic_error": sem_err}

    def versions(self, ranked):
        """Newest version in force first, and one copy of a duplicated attachment.

        - a cancelled document (cancel date passed) drops behind the ones in force;
        - within one law family (same title without "ฉบับที่ N" / year) the hits keep the
          family's places in the list, re-dealt newest effect date first;
        - the same law + page + text from two attachments is kept once.
        """
        if not self.newest_first:
            return ranked
        today = time.strftime("%Y-%m-%d")
        seen, out = set(), []
        for i, f in ranked:
            m = self.metas[i]
            sig = (m.get("law_id"), m.get("page"), self.docs[i][:200])
            if sig in seen:
                continue
            seen.add(sig)
            out.append((i, f))
        live = [x for x in out if not (self.metas[x[0]].get("cancel") and self.metas[x[0]]["cancel"] <= today)
                and not (self.metas[x[0]].get("effect", "") > today)]
        dead = [x for x in out if x not in live]
        for x in dead:
            m = self.metas[x[0]]
            if m.get("cancel") and m["cancel"] <= today:
                x[1]["cancelled"] = m["cancel"]
            else:
                x[1]["not_yet"] = m.get("effect")  # published, takes effect later
        ranked = live + dead
        fams = {}
        for pos, (i, f) in enumerate(ranked):
            fams.setdefault(family(self.metas[i].get("title")), []).append(pos)
        res = list(ranked)
        for slots in fams.values():
            if len(slots) > 1:
                members = sorted((ranked[p] for p in slots), key=lambda x: self.metas[x[0]].get("effect", ""), reverse=True)
                for p, x in zip(slots, members):
                    res[p] = x
        return res

    def find_docs(self, q="", k=10):
        """Find documents (PDFs) by title words: every word must appear, newest in force first."""
        if not getattr(self, "_docs", None):
            by = {}
            for i, m in enumerate(self.metas):
                d = by.setdefault(m.get("key"), {"key": m.get("key"), "title": m.get("title", ""), "type": m.get("type", ""),
                                                 "year": m.get("year", ""), "effect": m.get("effect", ""), "cancel": m.get("cancel", ""),
                                                 "pdf": m.get("source_url", ""), "sections": 0})
                d["sections"] += 1
            self._docs = list(by.values())
        today = time.strftime("%Y-%m-%d")
        words = [w for w in normalize(q).split() if w]
        out = []
        for d in self._docs:
            t = normalize(d["title"] + " " + d["type"] + " " + d["year"])
            if all(w in t for w in words):
                out.append({**d, "in_force": not (d["cancel"] and d["cancel"] <= today)})
        out.sort(key=lambda d: d["effect"] or "", reverse=True)  # newest first,
        out.sort(key=lambda d: not d["in_force"])  # then (stable) the ones in force ahead of cancelled
        return {"query": q, "total": len(out), "docs": out[:k]}

    def pdf_path(self, key):
        """The local copy of a document's PDF (downloaded once from the manifest's single direct
        link), only inside the corpus folder."""
        if not re.fullmatch(r"\d+_\d+", key or ""):
            return None
        path = os.path.realpath(self.dates.get(key, {}).get("path") or "")
        root = os.path.realpath(os.path.dirname(MANIFEST))
        return path if path.startswith(root + os.sep) and path.endswith(".pdf") and os.path.isfile(path) else None

    def doc(self, key):
        """Full OCR text of one document, page by page, plus its section list (for the reader)."""
        if not re.fullmatch(r"\d+_\d+", key or ""):
            return None
        import paths
        pages = paths.pages_in(paths.ocr_dir(key))
        secs = [(i, m) for i, m in enumerate(self.metas) if m.get("key") == key]
        if not pages and not secs:
            return None
        m0 = secs[0][1] if secs else {}
        secs.sort(key=lambda x: x[1].get("chunk", 0))
        return {"key": key, "title": m0.get("title", ""), "source_url": m0.get("source_url", ""), "pdf_local": bool(self.pdf_path(key)),
                "effect": m0.get("effect", ""), "cancel": m0.get("cancel", ""),
                "pages": [{"n": n, "text": normalize(open(f, encoding="utf-8").read())} for n, f in sorted(pages.items())],
                "sections": [{"id": self.ids[i], "section": m.get("section", ""), "chapter": m.get("chapter", ""),
                              "page": m.get("page"), "pages": m.get("pages", ""), "text": self.docs[i]} for i, m in secs]}

    def map(self):
        """Every section as a point on the 2-D map (proto/map.py), joined with its metadata."""
        path = os.path.join(HERE, ".map", f"{self.name}.json")
        if not os.path.exists(path):
            return None
        if getattr(self, "_map", None) and self._map[0] == os.path.getmtime(path):
            return self._map[1]
        m = json.load(open(path, encoding="utf-8"))
        xy = dict(zip(m["ids"], m["xy"]))
        today = time.strftime("%Y-%m-%d")
        types, docs, dkey, pts = [], [], {}, []
        for i, cid in enumerate(self.ids):
            if cid not in xy:
                continue
            md = self.metas[i]
            t = md.get("type", "")
            if t not in types:
                types.append(t)
            k = md.get("key")
            if k not in dkey:
                dkey[k] = len(docs)
                docs.append({"key": k, "title": md.get("title", ""), "year": md.get("year", ""),
                             "cancelled": bool(md.get("cancel") and md["cancel"] <= today)})
            pts.append([cid, *xy[cid], types.index(t), dkey[k], md.get("section", "")])
        sizes = sorted(len(d) for d in self.docs)
        out = {"collection": self.name, "n": len(pts), "types": types, "docs": docs, "points": pts,
               "chars_avg": round(sum(sizes) / len(sizes)), "chars_median": sizes[len(sizes) // 2], "chars_max": sizes[-1],
               "vocab": len(self.idf), "built": time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(path)))}
        self._map = (os.path.getmtime(path), out)
        return out

    def trace(self, q):
        """One question through every stage, as the chatbot runs it (k=6, reranker on)."""
        tr = {}
        res = self.search(q, k=6, rerank=True, trace=tr)
        on = self.reranker is not None
        gate = RERANK_GATE if on else GATE
        for h in res["hits"]:
            h["pass"] = strong(h, gate)
            h.pop("text", None)
        return {"query": res["query"], "expanded": res["expanded"], "semantic_error": res["semantic_error"],
                "gate": gate, "rerank_n": RERANK_N, "min_cosine": MIN_COSINE, "min_bm25_share": MIN_BM25_SHARE,
                "hits": res["hits"], **tr}

    # ---------- question log and frequent topics ----------
    LOG = os.path.join(HERE, ".logs", "questions.jsonl")  # members' questions: local only, gitignored
    TOPIC_SIM = 0.80  # two questions are one topic when their vectors are this close (cosine)

    def log_question(self, q, r, src="web"):
        top = r.get("sources") or r.get("considered") or []
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "src": src, "q": normalize(q)[:300], "answered": r.get("answered"),
               "ms": r.get("ms"), "docs": [{"key": h.get("key"), "title": h.get("title"), "section": h.get("section")} for h in top[:2]]}
        os.makedirs(os.path.dirname(self.LOG), exist_ok=True)
        with open(self.LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    def _qvecs(self, qs):
        """Question vectors, cached; one batched call to the embedding service for the new ones."""
        cache = self.__dict__.setdefault("_qcache", {})
        new = [q for q in qs if q not in cache]
        for i in range(0, len(new), 64):
            batch = new[i:i + 64]
            body = json.dumps({"model": MODEL, "input": [QUERY_PROMPT + q for q in batch]}).encode()
            req = urllib.request.Request(f"{ANE}/api/embed", data=body, headers={"Content-Type": "application/json"})
            for q, v in zip(batch, json.load(urllib.request.urlopen(req, timeout=120))["embeddings"]):
                n = math.sqrt(sum(x * x for x in v)) or 1
                cache[q] = [x / n for x in v]
        return [cache[q] for q in qs]

    def popular(self, k=8, include_test=False, days=0):
        """Frequent topics: questions grouped by meaning (greedy, most asked first), with how often
        each topic was asked, how often the bot could answer it, and the documents it cited."""
        rows = []
        if os.path.exists(self.LOG):
            since = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - days * 86400)) if days else ""
            for line in open(self.LOG, encoding="utf-8"):
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if (include_test or r.get("src") != "test") and r.get("ts", "") >= since:
                    rows.append(r)
        if not rows:
            return {"total": 0, "topics": []}
        freq = Counter(r["q"] for r in rows)
        uniq = [q for q, _ in freq.most_common()]
        try:
            vecs = dict(zip(uniq, self._qvecs(uniq)))
        except Exception as e:  # embedding service down: fall back to exact questions
            vecs, err = None, str(e)
        topics = []
        for q in uniq:
            home = None
            if vecs:
                for t in topics:
                    if sum(a * b for a, b in zip(vecs[q], t["vec"])) >= self.TOPIC_SIM:
                        home = t
                        break
            if home is None:
                home = {"label": q, "vec": vecs[q] if vecs else None, "questions": []}
                topics.append(home)
            home["questions"].append(q)
        out = []
        for t in topics:
            qs_ = set(t["questions"])
            rs = [r for r in rows if r["q"] in qs_]
            docs = Counter((d.get("title"), d.get("key")) for r in rs if r.get("answered") for d in r.get("docs", [])[:1])
            out.append({"label": t["label"], "asked": len(rs), "answered": sum(1 for r in rs if r.get("answered")),
                        "answer_rate": round(sum(1 for r in rs if r.get("answered")) / len(rs), 2),
                        "variants": [q for q in t["questions"] if q != t["label"]][:4],
                        "top_docs": [{"title": ti, "key": ke} for (ti, ke), _ in docs.most_common(2)],
                        "last": max(r["ts"] for r in rs)})
        out.sort(key=lambda t: (-t["asked"], t["label"]))
        return {"total": len(rows), "distinct": len(uniq), "topics": out[:k],
                "unanswered": [t for t in out if t["answered"] == 0][:k], "grouping": "embedding" if vecs else f"exact ({err})"}

    def chat(self, q, compare=False):
        r = self.answer(q, rerank=True)
        if compare and self.reranker is not None:
            r["base"] = self.answer(q, rerank=False)
        return r

    def answer(self, q, rerank=True):
        t0 = time.time()
        res = self.search(q, k=6, rerank=rerank)
        on = rerank and self.reranker is not None
        gate = RERANK_GATE if on else GATE
        for h in res["hits"]:
            h["pass"] = strong(h, gate)
        good = [h for h in res["hits"] if h["pass"]]
        out = {"query": res["query"], "expanded": res["expanded"], "semantic_error": res["semantic_error"],
               "mode": "rerank" if on else "base", "gate": gate, "ms": round((time.time() - t0) * 1000),
               "considered": res["hits"][:5]}
        if not good:
            return {**out, "answered": False, "sources": [],
                    "answer": "ไม่พบข้อมูลเรื่องนี้ในเอกสารในคลัง จึงไม่ตอบเพื่อไม่ให้เดา"}
        if on:
            self.guide(q, good[:3])
            out["ms"] = round((time.time() - t0) * 1000)
            out["guide_ms"] = self.last_guide_ms
        return {**out, "answered": True, "sources": good[:3], "answer": "ข้อความจากเอกสาร (อ้างอิงตามหมายเลข):"}

    def guide(self, q, hits):
        """Mark, in each quoted section, the span the reranker reads as the best answer to the question."""
        t0 = time.time()
        rq = expand(normalize(q))[0] if self.expand_terms else normalize(q)
        jobs = []
        for h in hits:
            sp = spans(h["text"])
            if len(sp) > 1:
                jobs += [(h, a, b) for a, b in sp]
        self.last_guide_ms = 0
        if not jobs:
            return
        scores = self.reranker.score(rq, [h["text"][a:b] for h, a, b in jobs])
        best = {}
        for (h, a, b), sc in zip(jobs, scores):
            if sc > best.get(h["id"], (None, -1))[1]:
                best[h["id"]] = ((a, b), sc)
        for h in hits:
            if h["id"] in best and best[h["id"]][1] >= GUIDE_MIN:  # a weak best span guides nobody
                (a, b), sc = best[h["id"]]
                h["guide"] = {"start": a, "end": b, "score": round(sc, 3)}
        self.last_guide_ms = round((time.time() - t0) * 1000)

def embed_ok():
    try:
        body = json.dumps({"model": MODEL, "input": ["ok"]}).encode()
        req = urllib.request.Request(f"{ANE}/api/embed", data=body, headers={"Content-Type": "application/json"})
        return len(json.load(urllib.request.urlopen(req, timeout=10))["embeddings"][0])
    except Exception:
        return 0


class Handler(BaseHTTPRequestHandler):
    index: Index = None

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path[:120]))

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if u.path == "/api/health":
            return self._send(200, {"collection": self.index.name, "chunks": len(self.index.ids),
                                    "rerank": bool(self.index.reranker),
                                    "docs": len({m["doc_id"] for m in self.index.metas}),
                                    "embed_dims": embed_ok(), "model": MODEL})
        if u.path == "/data/ocr_quality.json":  # per-page OCR scores for the review queue (proto/ocr_quality.py)
            qp = os.path.join(os.path.dirname(MANIFEST), "vec", "ocr_quality.json")
            if not os.path.exists(qp):
                return self._send(404, {"error": "not built: python proto/ocr_quality.py"})
            return self._send(200, open(qp, "rb").read(), "application/json; charset=utf-8")
        if u.path == "/api/pdf":  # the original PDF, served from the local copy so the reader can show it inline
            path = self.index.pdf_path((qs.get("key") or [""])[0])
            if not path:
                return self._send(404, {"error": "no local PDF for this document"})
            data = open(path, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", f'inline; filename="{os.path.basename(path)}"')
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "private, max-age=3600")
            self.end_headers()
            self.wfile.write(data)
            return
        if u.path == "/api/doc.md":  # one document as markdown: citation header, then OCR text by page
            d = self.index.doc((qs.get("key") or [""])[0])
            if not d:
                return self._send(404, b"no such document", "text/plain; charset=utf-8")
            head = [f"# {d['title']}", "", f"- เอกสาร: `{d['key']}`", f"- PDF ต้นฉบับ: {d['source_url']}",
                    f"- มีผล: {d['effect'] or '-'}" + (f" · ยกเลิกแล้ว: {d['cancel']}" if d["cancel"] else ""),
                    f"- {len(d['pages'])} หน้า · {len(d['sections'])} ข้อ/ส่วน · ข้อความจาก OCR (OpenThai) ตรวจกับ PDF ก่อนใช้", ""]
            body = [f"## หน้า {p['n']}\n\n{p['text']}\n" for p in d["pages"]]
            return self._send(200, "\n".join(head + body).encode(), "text/markdown; charset=utf-8")
        if u.path == "/api/doc":
            d = self.index.doc((qs.get("key") or [""])[0])
            return self._send(200, d) if d else self._send(404, {"error": "no such document"})
        if u.path == "/api/terms":  # live hint while typing: the legal words the search will add
            q = normalize((qs.get("q") or [""])[0])[:300]
            return self._send(200, {"query": q, "added": expand(q)[1] if q else []})
        if u.path == "/api/popular":  # frequent topics from the question log
            return self._send(200, self.index.popular(min(int((qs.get("k") or ["8"])[0]), 30),
                                                      (qs.get("test") or ["0"])[0] == "1", int((qs.get("days") or ["0"])[0])))
        if u.path == "/api/map":
            m = self.index.map()
            return self._send(200, m) if m else self._send(404, {"error": "map not built: python proto/map.py"})
        if u.path == "/api/trace":
            return self._send(200, self.index.trace((qs.get("q") or [""])[0]))
        if u.path == "/api/search":
            q = (qs.get("q") or [""])[0]
            mode = (qs.get("mode") or ["hybrid"])[0]
            if mode not in ("hybrid", "semantic", "keyword"):
                return self._send(400, {"error": "mode must be hybrid, semantic or keyword"})
            rerank = (qs.get("rerank") or ["0" if mode != "hybrid" else "1"])[0] == "1"
            return self._send(200, self.index.search(q, min(int((qs.get("k") or ["8"])[0]), 30), rerank=rerank, mode=mode))
        if u.path == "/api/docs":
            return self._send(200, self.index.find_docs((qs.get("q") or [""])[0], min(int((qs.get("k") or ["10"])[0]), 50)))
        return self._static(u.path)

    def do_POST(self):
        if urlparse(self.path).path != "/api/chat":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            q = body.get("q", "").strip()
        except json.JSONDecodeError:
            return self._send(400, {"error": "bad json"})
        if not q:
            return self._send(400, {"error": "empty question"})
        r = self.index.chat(q, compare=bool(body.get("compare")))
        try:
            self.index.log_question(q, r, str(body.get("src") or "web")[:12])
        except OSError as e:
            sys.stderr.write(f"question log: {e}\n")
        return self._send(200, r)

    def _static(self, path):
        rel = os.path.normpath(path.lstrip("/")) if path not in ("", "/") else "index.html"
        full = os.path.join(DIST, rel)
        if not full.startswith(DIST) or not os.path.isfile(full):
            full = os.path.join(DIST, "index.html")
        if not os.path.isfile(full):
            return self._send(503, b"web UI not built: cd proto/web && bun install && bun run build", "text/plain")
        ctype = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2"}.get(
            os.path.splitext(full)[1], "application/octet-stream")
        return self._send(200, open(full, "rb").read(), ctype + ("; charset=utf-8" if ctype.startswith("text") else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8796)
    ap.add_argument("--collection", default=COLLECTION)
    ap.add_argument("--no-rerank", action="store_true")
    a = ap.parse_args()
    rr = None
    if not a.no_rerank:
        try:
            from rerank import Reranker
            rr = Reranker()
        except Exception as e:  # sentence-transformers not installed: fused ranking + cos/match gate
            print(f"reranker off: {e}", flush=True)
    Handler.index = Index(a.collection, reranker=rr)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"craft-beer chatbot proto: http://127.0.0.1:{a.port}  ({Handler.index.name}: {len(Handler.index.ids)} chunks)", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
