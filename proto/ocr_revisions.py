#!/usr/bin/env python3
"""Pull the reviewers' corrected pages from Firestore into the corpus, so the next index build uses them.

  python3 proto/ocr_revisions.py [--project thai-excise-law] [--dry]

Reads every pages/{key}_{n} record (the back office at #/admin writes them) with the caller's gcloud login,
which must be an owner/editor of the Firebase project. Writes CORPUS/revised/<key>/page_NNNN.txt for every
page whose reviewed text differs from the OCR text and CORPUS/revised/log.jsonl (who, when, rev).
paths.pages_in() prefers a revised page over the OCR one. Then rebuild: sections.py -> server reload -> build_lite.
"""
import json
import os
import subprocess
import sys
import urllib.request

PROJECT = sys.argv[sys.argv.index("--project") + 1] if "--project" in sys.argv else os.environ.get("FIREBASE_PROJECT", "thai-excise-law")
CORPUS = os.path.expanduser(os.environ.get("EXCISE_CORPUS", "$EXCISE_CORPUS"))
DRY = "--dry" in sys.argv


def fs_val(v):
    for k in ("stringValue", "integerValue", "timestampValue", "booleanValue"):
        if k in v:
            return int(v[k]) if k == "integerValue" else v[k]
    return None


def main():
    token = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, check=True).stdout.strip()
    quota = os.environ.get("QUOTA_PROJECT", PROJECT)
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/pages?pageSize=300"
    docs, nxt = [], ""
    while True:
        req = urllib.request.Request(url + (f"&pageToken={nxt}" if nxt else ""),
                                     headers={"Authorization": f"Bearer {token}", "x-goog-user-project": quota})
        r = json.load(urllib.request.urlopen(req, timeout=60))
        docs += r.get("documents", [])
        nxt = r.get("nextPageToken")
        if not nxt:
            break
    out = os.path.join(CORPUS, "revised")
    fixed = approved = 0
    log = []
    for d in docs:
        f = {k: fs_val(v) for k, v in d.get("fields", {}).items()}
        key, n, status = f.get("key"), f.get("page"), f.get("status")
        if not key or not n:
            continue
        log.append({"key": key, "page": n, "status": status, "by": f.get("by"), "at": f.get("at"), "rev": f.get("rev")})
        p = os.path.join(out, key, f"page_{int(n):04d}.txt")
        text, base = f.get("text") or "", f.get("base") or ""
        if text != base:  # a reviewer changed the words (an approval of an earlier fix keeps the fix)
            fixed += 1
            if not DRY:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, "w", encoding="utf-8").write(text)
        else:
            approved += 1
            if not DRY and os.path.exists(p):  # reverted to the machine text
                os.remove(p)
    if not DRY:
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "log.jsonl"), "w", encoding="utf-8") as fh:
            for row in sorted(log, key=lambda x: (x["key"], x["page"])):
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"{len(docs)} reviewed pages: {fixed} fixed (written to {out}), {approved} approved as is" + (" [dry run]" if DRY else ""))


if __name__ == "__main__":
    main()
