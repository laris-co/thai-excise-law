#!/usr/bin/env python3
"""Retrieval eval, TEXT path vs OCR path, strict and twin-aware, then an answer-gate sweep.

  uv run --with chromadb --with numpy python proto/eval_chunks.py $EXCISE_CORPUS

Question sets
  page    eval/questions.json, 30 questions written by hand from sampled OCR pages (known doc + page)
  member  eval/questions.json, 10 questions in members' words from the 06-01 call topics; best doc =
          the newest rule in force, plus accepted docs / title pattern
  none    eval/questions.json, 10 questions the corpus cannot answer (3 are brewing how-to)
  title   the 20 subject-line questions from paths.py (known doc only)

Search configs: collection excise_text / excise_ocr (page windows) / excise_sec (one chunk per
ข้อ/มาตรา, sections.py) x base / terms (members' words -> legal words) / both (terms + newest
version in force first). A target document that has been cancelled is moved to its in-force
successor (same law family, newest effect date) and scored at doc level.

Scoring, top 5
  strict  the hit is the exact document (and page, for page questions)
  ok      twin-aware: the hit is any document with the same normalised subject ("twins": the corpus
          has 98 subjects shared by 380 documents, e.g. the same licence notice re-issued
          or attached twice), same page for page questions

Methods per path: dense (ChromaDB cosine only) and hybrid (server.Index: BM25 + cosine, RRF).

Gate sweep (OCR hybrid): for each gate, an answerable question is "right" when a cited
passage (first 3 that pass the gate) is the right doc (twin-aware), "wrong" when it
answers with other docs, "silent" when it refuses; a no-answer question is a "false
answer" when the gate lets anything through. Writes vec/eval-chunks.json.
"""
import itertools
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths  # noqa: E402
import server  # noqa: E402
from textnorm import normalize  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
K = 5


def subject(title):
    if not title or "เรื่อง" not in title:
        return re.sub(r"\s+", "", normalize(title or ""))
    s = normalize(title.split("เรื่อง", 1)[1])
    s = re.sub(r"\(ฉบับที่.*?\)|พ\.ศ\.\s*\d+", "", s)
    return re.sub(r"\s+", "", s)


def rank(hits, ok):
    return next((i + 1 for i, h in enumerate(hits[:K]) if ok(h)), None)


# name: (collection, expand terms, newest first)
CONFIGS = {
    "text_base": ("excise_text", False, False),
    "text_both": ("excise_text", True, True),
    "ocr_base": ("excise_ocr", False, False),
    "ocr_terms": ("excise_ocr", True, False),
    "ocr_both": ("excise_ocr", True, True),
    "sec_base": ("excise_sec", False, False),
    "sec_both": ("excise_sec", True, True),
    "sec_rr": ("excise_sec", True, True),    # + reranker, question as asked
    "sec_rrx": ("excise_sec", True, True),   # + reranker, question with the legal terms added
}
RERANKED = {"sec_rr": "asked", "sec_rrx": "expanded"}
GATED = ("ocr_both", "sec_both", "sec_rr", "sec_rrx")


def successors(D):
    """cancelled doc -> newest in-force doc of the same law family (None when there is none)"""
    today = __import__("time").strftime("%Y-%m-%d")
    fam = {}
    for r in D:
        fam.setdefault(server.family(r.get("title")), []).append(r)
    out = {}
    for r in D:
        c = (r.get("cancel_date") or "")[:10]
        if not c or c > today:
            continue
        live = [x for x in fam[server.family(r.get("title"))] if not x.get("cancel_date") and x["key"] != r["key"]]
        live.sort(key=lambda x: x.get("effect_date") or "", reverse=True)
        out[r["key"]] = live[0]["key"] if live else None
    return out


def main():
    D = paths.docs()
    subj = {r["key"]: subject(r.get("title")) for r in D}
    group = {}
    for k, s in subj.items():
        group.setdefault(s, set()).add(k)
    twins = {k: group[s] for k, s in subj.items()}
    succ = successors(D)

    qs = json.load(open(os.path.join(HERE, "eval", "questions.json"), encoding="utf-8"))
    for q in qs:
        q.setdefault("set", "page" if q["answerable"] else "none")
    qs += [{"q": q["q"], "key": q["key"], "type": q["type"], "answerable": True, "set": "title"} for q in paths.questions(D)]
    moved = {"page": 0, "title": 0, "no_successor": 0}
    for q in qs:
        if q.get("key") in succ:
            if succ[q["key"]]:
                q["was"], q["key"] = q["key"], succ[q["key"]]
                q.pop("page", None)  # the successor's page numbers differ: score it at doc level
                moved[q["set"]] += 1
            else:
                q["no_successor"] = True
                moved["no_successor"] += 1
    idx = {c: server.Index(c, False, False) for c in {v[0] for v in CONFIGS.values()}}
    from rerank import Reranker
    rr = Reranker()
    rr.score("warm up", ["warm up"])
    lat = {name: [] for name in CONFIGS}

    def judges(q):
        """strict: the exact doc; ok: a twin of it, another accepted doc, or a title the question accepts"""
        want = q["key"]
        ok_keys = set(twins.get(want, {want}))
        for k in q.get("keys", []):
            ok_keys |= twins.get(k, {k})
        at = re.compile(q["accept_title"]) if q.get("accept_title") else None
        strict = lambda h: h["key"] == want
        ok = lambda h: h["key"] in ok_keys or bool(at and at.search(h.get("title", "")))
        return strict, ok

    def score(row, q, name, hits):
        if not q["answerable"]:
            return
        strict, ok = judges(q)
        row[f"{name}_doc"] = rank(hits, strict)
        row[f"{name}_doc_ok"] = rank(hits, ok)
        if q.get("page"):
            pg = q["page"]
            on = lambda h: h["page"] == pg or (h.get("pages") and "-" in str(h["pages"]) and int(str(h["pages"]).split("-")[0]) <= pg <= int(str(h["pages"]).split("-")[1]))
            row[f"{name}_page"] = rank(hits, lambda h: strict(h) and on(h))
            row[f"{name}_page_ok"] = rank(hits, lambda h: ok(h) and on(h))

    rows = []
    for q in qs:
        row = {k: q.get(k) for k in ("q", "key", "was", "page", "type", "answerable", "set", "no_successor")}
        for name, (col, ex, nw) in CONFIGS.items():
            ix = idx[col]
            ix.expand_terms, ix.newest_first = ex, nw
            ix.reranker = rr if name in RERANKED else None
            ix.rerank_query = RERANKED.get(name, "asked")
            t0 = time.time()
            res = ix.search(q["q"], k=6)
            lat[name].append(time.time() - t0)
            score(row, q, name, res["hits"])
            if name in GATED:
                row[f"hits_{name}"] = [{"key": h["key"], "page": h["page"], "section": h.get("section", ""), "title": h["title"][:120],
                                        "cosine": h.get("cosine", 0), "match": h.get("match", 0), "match_q": h.get("match_q", 0),
                                        "rerank": h.get("rerank", 0)}
                                       for h in res["hits"]]
                row["expanded"] = res["expanded"]
        rows.append(row)
        print(f"{len(rows)}/{len(qs)}", row["set"], q["q"][:50], flush=True)

    summ = {"moved_to_successor": moved,
            "latency_s": {n: {"median": round(sorted(v)[len(v) // 2], 3), "p90": round(sorted(v)[int(len(v) * 0.9)], 3)} for n, v in lat.items()}}
    for st in ("page", "member", "title"):
        R = [r for r in rows if r["set"] == st]
        s = {"n": len(R)}
        for name in CONFIGS:
            for unit in (("doc", "page") if st == "page" else ("doc",)):
                for v in ("", "_ok"):
                    col = f"{name}_{unit}{v}"
                    n_ = sum(1 for r in R if f"{name}_{unit}" in r) if unit == "page" else len(R)
                    s[col] = f"{sum(1 for r in R if r.get(col) == 1)}/{sum(1 for r in R if r.get(col))} of {n_}"
        summ[st] = s

    def outcome(g, r, cname):
        good = [h for h in r[f"hits_{cname}"] if server.strong(h, g)][:3]
        if not r["answerable"]:
            return "false_answer" if good else "silent_ok"
        if not good:
            return "silent"
        q = next(x for x in qs if x["q"] == r["q"])
        return "right" if any(judges(q)[1](h) for h in good) else "wrong"

    def tally(g, cname, sets=("page", "member", "none")):
        c = {"right": 0, "wrong": 0, "silent": 0, "false_answer": 0, "silent_ok": 0}
        for r in rows:
            if r["set"] in sets:
                c[outcome(g, r, cname)] += 1
        return c

    gate_of = lambda c: server.RERANK_GATE if c in RERANKED else server.GATE
    summ["gate_now"] = {c: {st: tally(gate_of(c), c, (st,)) for st in ("page", "member", "none")} for c in GATED}
    summ["gate_best"], grid = {}, {}
    for cname in RERANKED:
        grid[cname] = [{"gate": {"rerank": t}, **tally({"rerank": t}, cname)} for t in [x / 100 for x in range(2, 96)]]
        ok = [x for x in grid[cname] if x["false_answer"] == 0]
        summ["gate_best"][cname] = sorted(ok, key=lambda x: (-x["right"], x["wrong"], x["gate"]["rerank"]))[:3]
        neg = sorted(((max((h["rerank"] for h in r[f"hits_{cname}"]), default=0), r["q"][:30]) for r in rows if r["set"] == "none"), reverse=True)
        summ.setdefault("none_max_rerank", {})[cname] = neg[:3]
        home = next((r for r in rows if r["q"].startswith("ทำเบียร์กินเองที่บ้านผิด")), None)
        if home:
            summ.setdefault("homebrew", {})[cname] = [(h["key"], h["section"], h["rerank"]) for h in home[f"hits_{cname}"][:3]]
    for cname in ("ocr_both", "sec_both"):
        grid[cname] = []
        for mk, co, ac, am, km, kc in itertools.product(("match", "match_q"), (0.6, 0.65, 0.7, 0.75), (0.5, 0.55, 0.6),
                                                        (0.4, 0.5, 0.6, 0.7), (0.6, 0.7, 0.8, 0.9), (0.3, 0.4, 0.5)):
            g = {"cos_only": co, "agree_cos": ac, "agree_match": am, "kw_match": km, "kw_cos": kc, "match_key": mk}
            grid[cname].append({"gate": g, **tally(g, cname)})
        summ["gate_best"][cname] = sorted(grid[cname], key=lambda x: (x["false_answer"], -x["right"], x["wrong"], -x["gate"]["cos_only"]))[:3]
    summ["none_max"] = {c: sorted(((max((h["cosine"] for h in r[f"hits_{c}"]), default=0), max((h["match"] for h in r[f"hits_{c}"]), default=0), r["q"][:30])
                                   for r in rows if r["set"] == "none"), reverse=True)[:3] for c in GATED}
    out = {"summary": summ, "rows": rows, "grid": grid}
    json.dump(out, open(os.path.join(paths.VEC, "eval-chunks.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(summ, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
