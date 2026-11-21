#!/usr/bin/env python3
"""Run the hosted build locally, the way Vercel will: static files from public/, the rest to api/index.py.

  uv run -q --with numpy --with tokenizers python proto/hosted_dev.py --port 8799
"""
import argparse
import os
import re
import sys
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deploy")
sys.path.insert(0, os.path.join(HERE, "api"))
import index  # noqa: E402

PUB = os.path.join(HERE, "public")
TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
         ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff"}


class Dev(index.handler):
    def _static(self, path):
        rel = "index.html" if path in ("", "/") else os.path.normpath(path.lstrip("/"))
        full = os.path.join(PUB, rel)
        if not full.startswith(PUB) or not os.path.isfile(full):
            full = os.path.join(PUB, "index.html")
        ctype = TYPES.get(os.path.splitext(full)[1], "application/octet-stream")
        return self._send(200, open(full, "rb").read(), ctype + ("; charset=utf-8" if ctype.startswith("text") or "json" in ctype else ""))

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/doc":  # vercel.json rewrite
            k = (parse_qs(u.query).get("key") or [""])[0]
            if re.fullmatch(r"\d+_\d+", k):
                return self._static(f"/data/doc/{k}.json")
        if u.path == "/api/map":
            return self._static("/data/map.json")
        if u.path.startswith("/api/") or u.path == "/mcp":
            return super().do_GET()
        return self._static(u.path)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8799)
    port = ap.parse_args().port
    index.idx()
    print(f"hosted build, local: http://127.0.0.1:{port}  (MCP: /mcp)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Dev).serve_forever()
