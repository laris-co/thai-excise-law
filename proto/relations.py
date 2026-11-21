"""Which document repeals or amends which, read from the documents' own text.

The manifest's cancel_date is often empty even when a newer rule has repealed a document (QA 2026-11-21:
the 2566 fee schedule and the 2560 regulations still showed "ใช้บังคับ"). The newer document says so itself:

  "ให้ยกเลิกกฎกระทรวงการผลิตสุรา พ.ศ. 2565"                  -> repeals that document
  "ให้ยกเลิกความใน (8) ของข้อ 2 แห่งกฎกระทรวงกำหนด..."        -> amends it (part of it is replaced)

relations() finds every other document's title right after such a clause (whitespace ignored, since OCR
wraps titles across lines) and returns, per document key, who repealed it and who amended it. A repeal
counts only once the repealing document is in effect.
"""
import re

from textnorm import normalize

CLAUSE = re.compile(r"ให้ยกเลิก")
HEAD = r"(?:พระราชบัญญัติ|พระราชกฤษฎีกา|กฎกระทรวง|ประกาศ|ระเบียบ|คำสั่ง)"


def _squash(t):
    return re.sub(r"\s+", "", normalize(t or ""))


def _core(title):
    """the part of a title that the repealing text quotes: drop '(ฉบับที่ N)' noise only when the text may omit it"""
    t = _squash(title)
    return t if len(t) >= 18 else ""


def relations(ids, docs, metas, today):
    """-> {key: {"repealed_by": {key, title, effect} | None, "amended_by": [{key, title, effect}]}}"""
    titles = {}
    for m in metas:
        k = m.get("key")
        if k and k not in titles:
            titles[k] = (m.get("title") or "", m.get("effect") or "")
    cores = sorted(((k, _core(t)) for k, (t, _) in titles.items() if _core(t)), key=lambda x: -len(x[1]))
    out = {}
    for text, m in zip(docs, metas):
        src = m.get("key")
        if not src or "ยกเลิก" not in text:
            continue
        flat = _squash(text)
        for c in CLAUSE.finditer(flat):
            after = flat[c.end():c.end() + 400]
            partial = not re.match(HEAD, after)  # "ให้ยกเลิกความใน ..." amends; "ให้ยกเลิก<กฎกระทรวง ...>" repeals
            hit = next((core for k, core in cores if k != src and 0 <= after.find(core) <= 300), None)
            if not hit:
                continue
            at = after.find(hit)
            st, eff = titles[src]
            ref = {"key": src, "title": st, "effect": eff}
            # every document with that exact title (the same notice is often filed twice)
            for k, core in cores:
                if core != hit or k == src:
                    continue
                if eff and titles[k][1] and eff < titles[k][1]:
                    continue  # an older text cannot repeal a newer one
                rel = out.setdefault(k, {"repealed_by": None, "amended_by": []})
                if not partial and at < 40 and eff and eff <= today:
                    # the clause names the whole document: a repeal, once the new one is in effect
                    if not rel["repealed_by"] or eff > rel["repealed_by"]["effect"]:
                        rel["repealed_by"] = ref
                elif all(x["key"] != src for x in rel["amended_by"]):
                    rel["amended_by"].append(ref)
    for rel in out.values():
        rel["amended_by"].sort(key=lambda a: a["effect"], reverse=True)
    return out


def apply(metas, rel):
    """Copy the relations onto every section's metadata. A repealed document gets a cancel date (the
    repealing document's effect date) when the manifest has none, so every 'cancelled' check sees it."""
    for m in metas:
        r = rel.get(m.get("key"))
        if not r:
            continue
        if r["repealed_by"]:
            m["repealed_by"] = r["repealed_by"]
            if not m.get("cancel"):
                m["cancel"] = r["repealed_by"]["effect"]
        if r["amended_by"]:
            m["amended_by"] = r["amended_by"][:3]


NONBEER = re.compile(r"(?:มิใช่|ไม่ใช่)สุราแช่ชนิดเบียร์")
IMPORT = re.compile(r"นำ(?:สุรา)?เข้ามาในราชอาณาจักร|นำเข้า|นำสุราเข้า")


def applies_to(title, text):
    """What a section is about, for the citation and for ranking: เบียร์ / สุราแช่อื่น / สุรากลั่น / นำเข้า."""
    title, text = title or "", text or ""
    tags = []
    rest = NONBEER.sub("", title + "\n" + text)
    if "ชนิดเบียร์" in rest or "เบียร์" in rest:
        tags.append("เบียร์")
    if NONBEER.search(title) or NONBEER.search(text):
        tags.append("สุราแช่อื่น")
    if "สุรากลั่น" in title:
        tags.append("สุรากลั่น")
    if IMPORT.search(title):
        tags.append("นำเข้า")
    return tags
