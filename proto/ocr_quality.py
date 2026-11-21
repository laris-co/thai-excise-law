#!/usr/bin/env python3
"""Score every OCR page so reviewers start with the worst ones.

  uv run -q --with pythainlp python proto/ocr_quality.py [CORPUS]     -> CORPUS/vec/ocr_quality.json

Per page, evidence a person can check (nothing here edits the text):
  num_lost     a heading word with its number gone ("มาตรา วรรคหนึ่ง", "ข้อ ให้ยกเลิก") — OCR drops Thai digits
  heading      a ข้อ heading misread ("ขอ ๓", "ข้อ๓" glued is fine)
  marks        Thai marks with no consonant before them, or two tone marks in a row
  odd          characters that are neither Thai, Latin, digits nor common punctuation
  unknown      share of Thai words (2+ letters) not in the pythainlp dictionary
  numbers      numbers the PDF's own text layer has that the OCR lacks (only on the 1,762 pages whose text
               layer is readable; the rest of the corpus has an empty or garbled layer)
  sim          character similarity to that text layer, when it is readable
  short/empty  almost no text on the page

score is 0..100 (100 = nothing found). grade: ok >= 85, check 60..84, fix < 60.
Per document, for the queue order (craft beer first): beer (the text is about beer, relations.applies_to),
liquor (any สุรา document), in_force (not cancelled or repealed, from deploy/data/sections.json.gz).
  --tags   only refresh those document fields in an existing ocr_quality.json
"""
import difflib
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else os.environ.get("EXCISE_CORPUS", "excise-laws"))
ARGS, sys.argv = sys.argv[1:], [sys.argv[0], CORPUS]  # paths.py reads the corpus from argv[1]
sys.path.insert(0, HERE)
import paths  # noqa: E402

THAI_DIG = "๐๑๒๓๔๕๖๗๘๙"
NUM_LOST = re.compile(r"(?:มาตรา|ข้อ|ฉบับที่|หมวด|ส่วนที่|บัญชีที่|ตอนที่|แบบ ภส\.)\s+(?=[ก-ฮเแโใไ])(?!ให้|ทั้ง|นี้|ดัง|ใด|ที่|และ|หรือ|ตาม|เป็น|ว่า|ก่อน)")
HEADING = re.compile(r"(?m)^\s*(?:ขอ|ข้อ\.|ช้อ|ซ้อ|ข้อํ)\s*[๐-๙0-9]+")
# a mark (above/below vowel or tone) not preceded by a consonant or another mark, or two tone marks in a row
MARKS = re.compile(r"(?<![ก-ฮัิ-ฺ็-๎])[ัิ-ฺ็-๎]|[่-๋]{2,}")
ODD = re.compile(r"[^฀-๿A-Za-z0-9\s.,:;()\[\]\"'“”‘’/\-–—_%&+=*#@!?<>|$฿…•·°§~^]")
NUM = re.compile(r"[๐-๙0-9][๐-๙0-9,.]*")


def thai_num(s):
    return s.translate(str.maketrans("0123456789", THAI_DIG)).strip(".,")


def text_layer(key, n):
    p = os.path.join(CORPUS, "text", key, f"page_{n:04d}.txt")
    if not os.path.exists(p):
        return ""
    t = open(p, encoding="utf-8", errors="ignore").read()
    th = sum(1 for c in t if "฀" <= c <= "๿")
    letters = sum(1 for c in t if c.isalpha())
    # readable = mostly Thai letters and few junk symbols (the broken-font layers are full of @#>/ and Latin)
    junk = sum(1 for c in t if c in "@#>/?!$^`")
    return t if letters > 80 and th / letters > 0.8 and junk < len(t) * 0.01 else ""


def tag(out):
    """Mark what each document is about and whether it is still in force (the review queue puts craft beer first)."""
    import gzip
    from relations import applies_to
    metas = {}
    sp = os.path.join(os.path.dirname(HERE), "deploy", "data", "sections.json.gz")
    if os.path.exists(sp):
        for m in json.load(gzip.open(sp, "rt", encoding="utf-8"))["metas"]:
            metas.setdefault(m.get("key"), m)
    today = __import__("time").strftime("%Y-%m-%d")
    for key, d in out.items():
        text = "\n".join(open(f, encoding="utf-8", errors="ignore").read() for f in paths.pages_in(paths.ocr_dir(key)).values())
        tags = applies_to(d.get("title"), text)
        m = metas.get(key, {})
        cancel = m.get("cancel") or ""
        d["beer"] = "เบียร์" in tags
        d["liquor"] = "สุรา" in (d.get("title") or "") or text.count("สุรา") >= 3
        d["in_force"] = not (cancel and cancel <= today) and not m.get("repealed_by")


def main():
    if "--tags" in ARGS:
        dst = os.path.join(CORPUS, "vec", "ocr_quality.json")
        out = json.load(open(dst, encoding="utf-8"))
        tag(out)
        json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False)
        v = list(out.values())
        print(f"beer {sum(d['beer'] for d in v)} · liquor {sum(d['liquor'] for d in v)} · in force {sum(d['in_force'] for d in v)} of {len(v)}")
        return
    try:
        from pythainlp.corpus import thai_words
        from pythainlp.tokenize import word_tokenize
        WORDS = set(thai_words())
    except ImportError:
        WORDS, word_tokenize = None, None
    out, D = {}, paths.docs()
    pr = paths.Progress("quality", len(D))
    for i, r in enumerate(D, 1):
        key = r["key"]
        pages = paths.pages_in(paths.ocr_dir(key))
        doc = []
        for n in sorted(pages):
            t = open(pages[n], encoding="utf-8", errors="ignore").read()
            body = re.sub(r"\s+", " ", t).strip()
            f, ex = {}, {}
            if len(body) < 40:
                f["empty" if len(body) < 5 else "short"] = 1
            hits = [m.group(0).strip() + " " + body[m.end():m.end() + 12] for m in NUM_LOST.finditer(body)]
            if hits:
                f["num_lost"], ex["num_lost"] = len(hits), hits[:3]
            h = HEADING.findall(t)
            if h:
                f["heading"], ex["heading"] = len(h), [x.strip() for x in h[:3]]
            mk = MARKS.findall(body)
            if mk:
                f["marks"] = len(mk)
            od = ODD.findall(body)
            if len(od) > 3:
                f["odd"], ex["odd"] = len(od), "".join(sorted(set(od)))[:20]
            if WORDS is not None and body:
                ws = [w for w in word_tokenize(body, keep_whitespace=False) if len(w) >= 2 and re.fullmatch(r"[ก-๛]+", w)]
                unk = [w for w in ws if w not in WORDS and not re.search(r"[๐-๙]", w)]
                share = len(unk) / len(ws) if ws else 0
                if share > 0.08:
                    f["unknown"], ex["unknown"] = round(share, 3), sorted(set(unk), key=unk.count, reverse=True)[:6]
            tl = text_layer(key, n)
            sim = None
            if tl:
                a, b = re.sub(r"\s+", "", tl), re.sub(r"\s+", "", t)
                sim = round(difflib.SequenceMatcher(None, a, b, autojunk=False).ratio(), 3) if len(a) < 8000 else None
                want = {thai_num(x) for x in NUM.findall(tl) if len(thai_num(x)) >= 1}
                have = {thai_num(x) for x in NUM.findall(t)}
                miss = sorted(want - have)
                if miss:
                    f["numbers"], ex["numbers"] = len(miss), miss[:8]
            score = 100
            score -= 25 * ("empty" in f) + 10 * ("short" in f)
            score -= min(30, 12 * f.get("num_lost", 0))
            score -= min(15, 5 * f.get("heading", 0))
            score -= min(10, 2 * f.get("marks", 0))
            score -= min(10, f.get("odd", 0) // 4)
            score -= min(20, int(150 * max(0, f.get("unknown", 0) - 0.08)))
            score -= min(30, 10 * f.get("numbers", 0))
            if sim is not None and sim < 0.9:
                score -= min(20, int(100 * (0.9 - sim)))
            score = max(0, score)
            doc.append({"page": n, "score": score, "grade": "ok" if score >= 85 else ("check" if score >= 60 else "fix"),
                        "flags": f, "ex": ex, "sim": sim, "textlayer": bool(tl)})
        if doc:
            out[key] = {"title": r.get("title"), "pages": doc, "score": round(sum(p["score"] for p in doc) / len(doc), 1),
                        "worst": min(p["score"] for p in doc)}
        pr.tick(i)
    tag(out)
    os.makedirs(os.path.join(CORPUS, "vec"), exist_ok=True)
    dst = os.path.join(CORPUS, "vec", "ocr_quality.json")
    json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False)
    allp = [p for d in out.values() for p in d["pages"]]
    g = {k: sum(1 for p in allp if p["grade"] == k) for k in ("ok", "check", "fix")}
    flags = {}
    for p in allp:
        for k in p["flags"]:
            flags[k] = flags.get(k, 0) + 1
    print(f"{len(out)} docs, {len(allp)} pages: ok {g['ok']} · check {g['check']} · fix {g['fix']}")
    print("pages per flag:", json.dumps(flags, ensure_ascii=False))
    print("wrote", dst)


if __name__ == "__main__":
    main()
