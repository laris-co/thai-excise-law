#!/usr/bin/env python3
"""End-to-end answer eval through the running chatbot API (what a member gets).

  python3 proto/eval_api.py [--api http://127.0.0.1:8796] [--qa]

For every question in eval/questions.json: POST /api/chat, then
  right   answered, and one of the cited documents is the expected one (key, keys or accept_title)
  other   answered, but from other documents only
  silent  an answerable question refused
  false   a no-answer question answered
--qa also runs the QA-report questions (proto/QA-2026-11-21.md) and prints their top citation.
Questions go in with src=test, so they stay out of the members' frequent topics.
"""
import json
import re
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = sys.argv[sys.argv.index("--api") + 1] if "--api" in sys.argv else "http://127.0.0.1:8796"

QA = [  # question, the document (and clause) a right answer cites, from the QA run
    ("ต้องยื่นต่ออายุใบอนุญาตผลิตเบียร์ก่อนหมดอายุกี่วัน", "9468_7168", "ข้อ 5"),
    ("โรงเบียร์ขนาดเล็กใช้เครื่องจักรได้กี่แรงม้า คนงานได้กี่คน", "9468_7168", "ข้อ 2"),
    ("ทำเบียร์กินเองได้ปีละกี่ลิตร", "9468_7168", "ข้อ 2"),
    ("ฉลากเบียร์ที่ผลิตในประเทศต้องมีข้อความอะไรบ้าง", "9473_7247", "ข้อ 5"),
    ("ขนเบียร์ออกจากโรงงานต้องมีเอกสารอะไร", "9454_7251", "ข้อ 14"),
    ("ผลิตเบียร์โดยไม่มีใบอนุญาตมีโทษอะไร", "5790_6542", "มาตรา 193"),
    ("What is the excise tax rate on beer?", "8286_5650", ""),
    ("brewpub license fee", "9469_7169", ""),
    ("หิ้วเบียร์กลับจากต่างประเทศมากินเองได้กี่ลิตร", "9884_7681", ""),
]


def chat(q):
    req = urllib.request.Request(f"{API}/api/chat", data=json.dumps({"q": q, "src": "test"}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=300))


def main():
    # scored the way eval_chunks.py scores the gate: twin-aware (the same subject re-issued under another
    # key counts) and a cancelled target moved to its in-force successor
    sys.path.insert(0, HERE)
    qa = "--qa" in sys.argv
    sys.argv = [sys.argv[0], os.path.expanduser(os.environ.get("EXCISE_CORPUS", "excise-laws"))]  # paths.py reads the corpus from argv[1]
    import paths
    from eval_chunks import subject, successors
    D = paths.docs()
    group = {}
    for r in D:
        group.setdefault(subject(r.get("title")), set()).add(r["key"])
    twins = {r["key"]: group[subject(r.get("title"))] for r in D}
    succ = successors(D)
    qs = json.load(open(os.path.join(HERE, "eval", "questions.json"), encoding="utf-8"))
    for q in qs:
        if succ.get(q.get("key")):
            q["key"] = succ[q["key"]]
    c = {"right": 0, "other": 0, "silent": 0, "false": 0}
    for q in qs:
        r = chat(q["q"])
        if not q.get("answerable"):
            c["false"] += bool(r.get("answered"))
            continue
        if not r.get("answered"):
            c["silent"] += 1
            continue
        keys = set()
        for k in (q.get("keys") or []) + ([q["key"]] if q.get("key") else []):
            keys |= twins.get(k, {k})
        at = re.compile(q["accept_title"]) if q.get("accept_title") else None
        ok = any(s.get("key") in keys or bool(at and at.search(s.get("title") or "")) for s in r["sources"])
        c["right" if ok else "other"] += 1
    n_ans = sum(1 for q in qs if q.get("answerable"))
    print(f"eval {len(qs)} q ({n_ans} answerable): right {c['right']} · other doc {c['other']} · silent {c['silent']} · "
          f"false answers {c['false']} of {len(qs) - n_ans}")
    if qa:
        for q, key, sec in QA:
            r = chat(q)
            src = r.get("sources") or []
            hit = next((i + 1 for i, s in enumerate(src) if s.get("key") == key and (not sec or s.get("section", "").startswith(sec))), None)
            top = f"{src[0].get('key')} {src[0].get('section') or ''}".strip() if src else "refused"
            print(f"{'OK ' if hit == 1 else ('#' + str(hit) + ' ' if hit else 'NO ')} {q[:42]:42} | top: {top} | want {key} {sec}")


if __name__ == "__main__":
    main()
