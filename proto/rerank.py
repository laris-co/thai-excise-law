"""Local cross-encoder reranker over the fused top-20 sections.

BAAI/bge-reranker-v2-m3 (multilingual, 568M) through sentence-transformers on Apple mps.
It reads the question and each passage together, so "ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม" can match
"ใบอนุญาตผลิตสุราที่มิใช่เพื่อการค้า" even when few words overlap. The score (sigmoid, 0..1)
replaces the cosine + keyword rules in the answer gate.

  uv run --with sentence-transformers --with torch python proto/rerank.py   # smoke test
"""
import os
import time

MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
MAX_LEN = 512


class Reranker:
    def __init__(self, model=MODEL):
        import torch
        from sentence_transformers import CrossEncoder
        dev = "mps" if torch.backends.mps.is_available() else "cpu"
        self.device = dev
        self.model = CrossEncoder(model, device=dev, max_length=MAX_LEN)

    def score(self, q, passages):
        """passages: list of str -> list of float in 0..1"""
        if not passages:
            return []
        import torch
        s = self.model.predict([(q, p) for p in passages], batch_size=20, activation_fn=torch.nn.Sigmoid(),
                               show_progress_bar=False)
        return [float(x) for x in s]


def passage(h):
    """What the reranker reads: law title, section, then the text."""
    head = " ".join(x for x in (h.get("title", ""), h.get("chapter", ""), h.get("section", "")) if x)
    return f"{head}\n{h.get('text', '')}"


if __name__ == "__main__":
    t = time.time()
    r = Reranker()
    print(f"loaded on {r.device} in {time.time() - t:.1f}s", flush=True)
    q = "ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม"
    ps = ["กฎกระทรวงการผลิตสุรา พ.ศ. 2568 ข้อ 10\nในการออกใบอนุญาตผลิตสุราที่มิใช่เพื่อการค้า อธิบดีจะกำหนดเงื่อนไขให้ผู้ได้รับใบอนุญาตปฏิบัติ",
          "ประกาศกรมสรรพสามิต เรื่อง รถยนต์กระบะ ข้อ 2\nต้องมีการติดตั้งระบบ ADAS อย่างน้อย 1 ระบบ"] * 10
    for _ in range(2):
        t = time.time()
        s = r.score(q, ps)
        print(f"20 pairs in {time.time() - t:.2f}s", [round(x, 3) for x in s[:2]], flush=True)
