#!/usr/bin/env python3
"""Section-aware chunks: split each OCR'd law on its ข้อ / มาตรา headings.

  uv run --with chromadb --with numpy python proto/sections.py $EXCISE_CORPUS [--limit N] [--dry]

Why: page windows cut a rule in the middle, so search finds the right law but quotes the
wrong part of it (feature #4 quoted a transitional clause). One chunk per ข้อ/มาตรา keeps a
rule whole and lets the citation say "ข้อ 5" (design A+B, no generator).

OCR quirks handled (seen in 9468_7168, 9473_7247, 5790_6465):
  - the heading word comes out as ข้อ, ข้, ขอ or ข; มาตรา stays clean
  - the number is often lost: "ข คำขอรับใบอนุญาต..." -> a heading with no number
  - references wrap to a line start ("มาตรา 120 มาตรา 121 ...") -> a numbered heading is only
    accepted when it continues the sequence (last + 1..3), or starts it (1..3)
A heading without a number gets one only when the numbers on both sides confirm it
(prev known + gap == next known); otherwise its label is "ถัดจากข้อ N" so a citation never
states a number the page does not show.

Chunk = one section (split into ~1000-char parts with overlap when longer than 1400), with
metadata section label, chapter (หมวด line), first page and page range. The embedding text is
"title | chapter | section" + body, so a rule carries its law's name; BM25 sees the body only.
A document with no headings (forms, tables) falls back to page windows labelled "".
Writes ChromaDB collection excise_sec.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths  # noqa: E402
from ingest import chunk_page  # noqa: E402
from textnorm import normalize  # noqa: E402

COLLECTION = "excise_sec"
MAX, PART, OVER = 1400, 1000, 150
# a numbered heading: the number may be glued to the next word ("ข้อ 2ในกฎกระทรวงนี้")
HEAD = re.compile(r"^[ \t]*(ข้อ|ข้|ขอ|ข|มาตรา)[ \t]*(\d{1,3}(?:/\d{1,2})?)(?=[ \t]|$|[\u0E00-\u0E7F“\"(])(?!\.\d)(.*)$", re.M)
# a heading whose number OCR lost: the word, a space, then the text ("ขอ ผู้ได้รับใบอนุญาต")
BARE = re.compile(r"^[ \t]*(ข้อ|ข้|ขอ|ข)[ \t]+(?!\d)(.*)$", re.M)
# words a ข้อ body opens with; "ข" glued straight onto one of them is a heading ("ขผู้ยื่นคำขอ"),
# since no Thai word starts with those letters after ข
STARTERS = r"(?:ผู้|ให้|การ|ใน|กรณี|เมื่อ|บรรดา|คำขอ|คำสั่ง|ระเบียบ|ประกาศ|กฎกระทรวง|ภายใน|หาก|ถ้า|สำหรับ|เพื่อ|ทั้งนี้|ห้าม|โรง|สุรา)"
GLUED = re.compile(r"^[ \t]*(ข)(?=" + STARTERS + r")(.*)$", re.M)
# มาตรา also starts mid-line after OCR joins lines, often misspelt (มตรา, มาตา, มตา, ม)
MID = re.compile(r"(?:(?<=\s)|^)(มาตรา|มตรา|มาตา|มตา|มต|ม)[ \t]?(\d{1,3}(?:/\d{1,2})?)(?=[ \t])(?!\.\d)", re.M)
STEP = 15  # a numbered heading may skip up to this many (OCR misses some)
ANNEX = re.compile(r"^[ \t]*(บัญชีท้าย|บัญชีอัตรา|แบบท้าย|ท้ายประกาศ|ท้ายกฎกระทรวง|ท้ายพระราชบัญญัติ)[^\n]{0,80}$", re.M)
CHAPTER = re.compile(r"^[ \t]*(หมวด|ส่วนที่|บทเฉพาะกาล)[ \t]*(\d{1,2})?[ \t]*$", re.M)


def kind(word):
    return "มาตรา" if word == "มาตรา" else "ข้อ"


def doc_text(key):
    """All OCR pages joined, with the page number of every character."""
    pages = paths.pages_in(paths.ocr_dir(key))
    text, owner = [], []
    for n, p in sorted(pages.items()):
        t = normalize(open(p, encoding="utf-8").read()) + "\n"
        text.append(t)
        owner += [n] * len(t)
    return "".join(text), owner


def headings(text):
    """Accepted heading positions: [(start, kind, number or None)]."""
    out, last = [], {}
    cands = [(m.start(), m.group(1), m.group(2), m.group(3).strip()) for m in HEAD.finditer(text)]
    seen = {c[0] for c in cands}
    for rx in (BARE, GLUED):
        for m in rx.finditer(text):
            if m.start() not in seen:
                cands.append((m.start(), m.group(1), None, m.group(2).strip()))
                seen.add(m.start())
    cands += [(m.start(), "มาตรา", m.group(2), "") for m in MID.finditer(text) if m.start() not in seen
              and not any(abs(m.start() - c) < 4 for c in seen)]
    cands.sort()
    for start, word, num, rest in cands:
        k = kind(word)
        if num:
            n = int(num.split("/")[0])
            prev = last.get(k)
            if (prev is None and n <= 10) or (prev is not None and prev < n <= prev + STEP) or (prev is not None and "/" in num and n == prev):
                out.append((start, k, num))
                last[k] = n
            elif prev is not None and "/" not in num:
                # OCR dropped a digit: "ขอ 1" where ข้อ 15 belongs. Take the next expected number whose
                # digits contain the ones OCR kept, in order.
                fix = next((e for e in range(prev + 1, prev + 4) if len(str(e)) > len(num) and _sub(num, str(e))), None)
                if fix:
                    out.append((start, k, str(fix)))
                    last[k] = fix
        elif word != "มาตรา" and rest and re.match(r"[ก-๙“\"(]", rest) and (k in last or word == "ข้อ" or re.match(STARTERS, rest)):
            # numberless ข้อ heading: inside a run of numbered ones, or opening with a word a clause
            # opens with (a lone "ขอ" line start is otherwise a verb)
            out.append((start, k, None))
    return out


def _sub(short, long):
    """short's characters appear in long, in order"""
    it = iter(long)
    return all(c in it for c in short)


def label_all(heads):
    """Fill missing numbers only when both neighbours confirm them."""
    labels = []
    for i, (pos, k, num) in enumerate(heads):
        if num:
            labels.append(f"{k} {num}")
            continue
        j = i - 1
        while j >= 0 and not (heads[j][2] and heads[j][1] == k):
            j -= 1
        nxt = i + 1
        while nxt < len(heads) and not (heads[nxt][2] and heads[nxt][1] == k):
            nxt += 1
        if j >= 0 and "/" not in heads[j][2]:
            prev = int(heads[j][2])
            gap = i - j
            if nxt < len(heads) and "/" not in heads[nxt][2] and int(heads[nxt][2]) == prev + (nxt - j):
                labels.append(f"{k} {prev + gap}")
            else:
                labels.append(f"ถัดจาก{k} {prev}")
        elif nxt < len(heads) and "/" not in heads[nxt][2] and int(heads[nxt][2]) - (nxt - i) >= 1:
            # before the first numbered heading: count back from it ("ข้อ ให้ยกเลิก" then "ข้อ 2")
            labels.append(f"{k} {int(heads[nxt][2]) - (nxt - i)}")
        else:
            labels.append(k)
    return labels


def chapters(text):
    return [(m.start(), " ".join(text[m.start():].split("\n")[:2]).strip()[:80]) for m in CHAPTER.finditer(text)]


def sections(key):
    text, owner = doc_text(key)
    if not text.strip():
        return []
    heads = headings(text)
    numbered = sum(1 for h in heads if h[2])
    out = []
    if numbered < 2:
        for n, p in sorted(paths.pages_in(paths.ocr_dir(key)).items()):
            for j, c in enumerate(chunk_page(normalize(open(p, encoding="utf-8").read()))):
                if len(c) >= 20:
                    out.append({"section": "", "chapter": "", "page": n, "pages": str(n), "part": j, "text": c})
        return out
    labels = label_all(heads)
    chaps = chapters(text)
    last_head = heads[-1][0]
    annex = [(m.start(), "บัญชีท้าย") for m in ANNEX.finditer(text) if m.start() > last_head][:1]
    bounds = [(0, "ส่วนนำ", None)] + [(h[0], lab, h[2]) for h, lab in zip(heads, labels)] + [(a, lab, None) for a, lab in annex]
    bounds.sort()
    for i, (start, lab, num) in enumerate(bounds):
        end = bounds[i + 1][0] if i + 1 < len(bounds) else len(text)
        nxt = next((b[2] for b in bounds[i + 1:] if b[2]), None)
        # parts after the first are only "part of" this section when the next heading follows on
        loose = i + 1 >= len(bounds) or (num and nxt and "/" not in num and "/" not in nxt and int(nxt) - int(num) > 3)
        body = text[start:end].strip()
        if len(body) < 20:
            continue
        chap = next((c for pos, c in reversed(chaps) if pos <= start), "")
        parts = [body] if len(body) <= MAX else [body[s:s + PART] for s in range(0, len(body) - OVER, PART - OVER)]
        for j, part in enumerate(parts):
            s0 = start + (j * (PART - OVER) if len(parts) > 1 else 0)
            p0 = owner[min(s0, len(owner) - 1)]
            p1 = owner[min(s0 + len(part), len(owner) - 1)]
            if len(parts) == 1:
                name = lab
            elif lab == "ส่วนนำ" and j > 0:
                name = f"ก่อน{bounds[1][1]}" if len(bounds) > 1 else lab
            elif (loose or len(parts) > 4) and j > 0:
                name = f"ต่อจาก{lab}"
            else:
                name = f"{lab} (ส่วน {j + 1}/{len(parts)})"
            out.append({"section": name, "chapter": chap,
                        "page": p0, "pages": f"{p0}-{p1}" if p1 != p0 else str(p0), "part": j, "text": part})
    return out


def main():
    args = sys.argv[2:]
    limit = int(args[args.index("--limit") + 1]) if "--limit" in args else None
    D = paths.docs()[:limit] if limit else paths.docs()
    units, stats = [], {"docs": 0, "sectioned": 0, "chunks": 0, "labelled": 0, "numbered": 0}
    for r in D:
        secs = sections(r["key"])
        stats["docs"] += 1
        stats["sectioned"] += any(s["section"] for s in secs)
        for i, s in enumerate(secs):
            stats["chunks"] += 1
            stats["labelled"] += bool(s["section"]) and s["section"] != "ส่วนนำ"
            stats["numbered"] += bool(re.search(r"(ข้อ|มาตรา) \d", s["section"])) and "ถัดจาก" not in s["section"]
            title = (r.get("title") or "")[:300]
            units.append((f"{r['key']}:s{i}", s["text"], f"{title} | {s['chapter']} | {s['section']}\n{s['text']}",
                          {"key": r["key"], "law_id": r["law_id"], "doc_id": r["doc_id"], "type_id": r["type_id"], "type": r["type"],
                           "year": r["year_be"], "title": title, "page": s["page"], "pages": s["pages"],
                           "section": s["section"], "chapter": s["chapter"], "chunk": i}))
    print(json.dumps(stats, ensure_ascii=False), flush=True)
    if "--dry" in args:
        for u in units[:400:13]:
            print(u[3]["key"], "p", u[3]["pages"], "|", u[3]["chapter"][:30], "|", u[3]["section"], "|", u[1][:90].replace("\n", " "))
        return
    import chromadb
    client = chromadb.PersistentClient(path=paths.DB)
    try:
        client.delete_collection(COLLECTION)
    except Exception:
        pass
    col = client.create_collection(COLLECTION, metadata={"hnsw:space": "cosine"})
    pr = paths.Progress("embed sections", len(units))
    for i in range(0, len(units), 64):
        b = units[i:i + 64]
        col.add(ids=[u[0] for u in b], documents=[u[1] for u in b], metadatas=[u[3] for u in b],
                embeddings=paths.embed([u[2] for u in b], paths.DOC_P))
        pr.tick(min(i + 64, len(units)))
    print(f"{COLLECTION}: {col.count()} chunks", flush=True)


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"done in {(time.time() - t0) / 60:.1f} min", flush=True)
