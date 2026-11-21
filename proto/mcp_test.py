#!/usr/bin/env python3
"""End-to-end test of proto/mcp_server.py over real MCP stdio, plus an OCR quality check.

  uv run --with "mcp<2" python proto/mcp_test.py            # stdio (spawns the server)
  uv run --with "mcp<2" python proto/mcp_test.py --http     # against http://127.0.0.1:8798/mcp
"""
import asyncio
import json
import os
import re
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

HERE = os.path.dirname(os.path.abspath(__file__))


def ocr_quality(text):
    body = re.sub(r"--- หน้า \d+ ---", "", text)
    chars = [c for c in body if not c.isspace()]
    n = len(chars) or 1
    thai = sum(1 for c in chars if "฀" <= c <= "๿")
    latin_digit = sum(1 for c in chars if c.isascii() and c.isalnum())
    odd = [c for c in chars if not ("฀" <= c <= "๿" or c.isascii())]
    split_am = body.count("ํา")  # ำ written as  ํ + า (a common OCR/text-layer fault)
    # a Thai upper/lower mark with no base consonant before it = broken glyph order
    orphan = len(re.findall(r"(?:^|[\s\x00-\x7f])[ัิ-ฺ็-๎]", body))
    return {"chars": n, "thai_share": round(thai / n, 3), "latin_digit_share": round(latin_digit / n, 3),
            "odd_chars": len(odd), "odd_sample": "".join(sorted(set(odd)))[:20], "split_am": split_am, "orphan_marks": orphan}


async def run(session):
    tools = await session.list_tools()
    print("TOOLS:", [t.name for t in tools.tools])

    async def call(name, **args):
        r = await session.call_tool(name, args)
        data = json.loads(r.content[0].text)
        return data

    st = await call("corpus_stats")
    print("\nSTATS:", st)

    for mode in ("semantic", "keyword", "hybrid"):
        r = await call("search_law", query="ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม", mode=mode, k=3)
        print(f"\nSEARCH {mode}: terms={r.get('expanded_terms')}")
        for h in r["hits"]:
            print(f"  {h['scores']}  {h['title'][:55]} {h['section'] or ''} p.{h['page']}  pdf={h['pdf']}")

    a = await call("ask_law", question="ค่าธรรมเนียมใบอนุญาตผลิตเบียร์เท่าไร")
    print(f"\nASK answered={a['answered']} ms={a['ms']}")
    print(a["markdown"][:900])

    n = await call("ask_law", question="วิธีต้มเบียร์ IPA ต้องใช้ฮอปส์พันธุ์อะไร")
    print(f"\nASK (out of scope) answered={n['answered']}: {n['markdown']}")

    pt = await call("popular_topics", k=5, include_test=True)
    print(f"\nPOPULAR_TOPICS total={pt['total']} grouping={pt['grouping']}")
    print(pt["markdown"])

    f = await call("find_pdf", title_words="ค่าธรรมเนียม ใบอนุญาต", k=4)
    print(f"\nFIND_PDF total={f['total']}")
    print(f["markdown"])

    print("\nOCR QUALITY (read_ocr, first 3 pages of the first 4 documents found):")
    for d in f["docs"][:4]:
        o = await call("read_ocr", doc_key=d["key"], page_from=1, page_to=3, max_chars=20000)
        q = ocr_quality(o["text"])
        print(f"  {d['key']} pages {o['pages_returned']}/{o['pages_total']} {q}")
    o = await call("read_ocr", doc_key=f["docs"][1]["key"], page_from=1, page_to=1, max_chars=700)
    print("\nOCR SAMPLE:", o["title"], o["pdf"], o["ocr_md"])
    print(o["text"])


async def main():
    if "--http" in sys.argv:
        from mcp.client.streamable_http import streamablehttp_client
        async with streamablehttp_client("http://127.0.0.1:8798/mcp") as (r, w, _):
            async with ClientSession(r, w) as s:
                await s.initialize()
                await run(s)
        return
    params = StdioServerParameters(command="uv", args=["run", "-q", "--with", "mcp<2", "python", os.path.join(HERE, "mcp_server.py")])
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            await run(s)


asyncio.run(main())
