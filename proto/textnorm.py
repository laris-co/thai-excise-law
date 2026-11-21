"""Thai text normalisation and tokenising shared by ingest and search.

Excise PDFs store sara am as nikhahit + sara aa (ํ + า), mix Thai and Arabic digits,
and OCR leaves ragged whitespace. Search must see one form of each, so every chunk
and every query goes through normalize() first.
"""
import re
import unicodedata

THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
NIKHAHIT = "ํ"   # ํ
SARA_AA = "า"    # า
SARA_AM = "ำ"    # ำ
THAI_TONES = "่้๊๋"


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFC", text)
    # ํ (+ optional tone mark) + า  ->  (tone) + ำ ; also catch a stray space between them
    t = re.sub(f"{NIKHAHIT}([{THAI_TONES}]?)\\s?{SARA_AA}", f"\\1{SARA_AM}", t)
    t = re.sub(f"([{THAI_TONES}]){NIKHAHIT}{SARA_AA}", f"\\1{SARA_AM}", t)
    t = t.translate(THAI_DIGITS)
    t = re.sub(r"[ \t\u00a0\u200b]+", " ", t)  # space, tab, no-break space, zero-width space
    t = re.sub(r" *\n *", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def tokens(text: str) -> list[str]:
    """Tokens for BM25 without a Thai word segmenter: Latin/digit words whole,
    Thai runs as overlapping character trigrams (bigrams for 2-char runs)."""
    out = []
    for run in re.findall(r"[฀-๿]+|[A-Za-z0-9]+", normalize(text).lower()):
        if re.match(r"[A-Za-z0-9]", run):
            out.append(run)
        elif len(run) < 3:
            out.append(run)
        else:
            out.extend(run[i:i + 3] for i in range(len(run) - 2))
    return out
