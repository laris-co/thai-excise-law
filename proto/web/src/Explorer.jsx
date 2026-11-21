import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Filter, LocateFixed, Search, X } from "lucide-react";
import Nav from "./Nav.jsx";

/* The search explorer: every section of the corpus as a point on a 2-D map of its vector
   (UMAP of the prebuilt embeddinggemma vectors, proto/map.py), and one question walked through
   every stage the chatbot runs: words → BM25, meaning → vector search, RRF fusion, rerank, gate. */

const TH = "๐๑๒๓๔๕๖๗๘๙";
const thai = (n) => String(n).replace(/\d/g, (d) => TH[d]);
const num = (n) => Number(n).toLocaleString("th-TH");

// law types: one distinct ink each, all at least 3:1 on white. Amber and red stay reserved.
const TYPE_INK = {
  "ประกาศกรมสรรพสามิต": "#3f7358",
  "กฎกระทรวง": "#1d5aa8",
  "ระเบียบกรมสรรพสามิต": "#7440a8",
  "ประกาศกระทรวงการคลัง": "#00777a",
  "คำสั่งกรมสรรพสามิต": "#7a5a00",
  "พ.ร.บ.ภาษีสรรพสามิต 2560": "#1a1d1b",
};
const OTHER_INK = "#5f6863";
// each search stage has one colour, the same on the map, in the panel and in the legend
const STAGE_INK = { bm25: "#1450b0", semantic: "#00736a", fused: "#6a35b0", rerank: "#16683f", final: "#9a4d00" };
const FAIL_INK = "#3a3f3c";
const inkOf = (t) => TYPE_INK[t] || OTHER_INK;

const EXAMPLES = ["ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม", "อัตราภาษีเบียร์", "ค่าธรรมเนียมใบอนุญาตผลิตเบียร์", "อุณหภูมิเสิร์ฟเบียร์"];

const STAGES = [
  { key: "bm25", n: 2, label: "ค้นตามคำ", tech: "BM25", note: "ส่วนที่มีชิ้นคำ ๓ ตัวอักษรตรงกับคำถาม" },
  { key: "semantic", n: 3, label: "ค้นตามความหมาย", tech: "เวกเตอร์ · cosine", note: "ส่วนที่ความหมายใกล้คำถามที่สุด" },
  { key: "fused", n: 4, label: "รวมสองรายการ", tech: "RRF", note: "ได้คะแนน 1/(60+อันดับ) จากแต่ละรายการ" },
  { key: "rerank", n: 5, label: "อ่านทวนแล้วจัดอันดับใหม่", tech: "bge-reranker-v2-m3", note: "โมเดลอ่านคำถามคู่กับข้อความทีละส่วน" },
  { key: "final", n: 6, label: "ผ่านเกณฑ์ → ใช้ตอบ", tech: "rerank ≥ 0.5", note: "ต่ำกว่าเกณฑ์ ระบบไม่ตอบ (ไม่เดา)" },
];

function useMap() {
  const [map, setMap] = useState(null);
  useEffect(() => {
    let timer;
    const load = () =>
      fetch("/api/map")
        .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error))))
        .then(setMap)
        .catch((e) => {
          setMap({ error: String(e) });
          timer = setTimeout(load, 5000);
        });
    load();
    return () => clearTimeout(timer);
  }, []);
  return map;
}

/* ---------- the map ---------- */

function MapCanvas({ map, trace, stage, hover, setHover, pick, picked }) {
  const wrap = useRef(null);
  const cvs = useRef(null);
  const [size, setSize] = useState({ w: 600, h: 520 });
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });
  const drag = useRef(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      setSize({ w, h: Math.round(Math.min(Math.max(w * 0.82, 340), 760)) });
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const pts = map.points;
  const byId = useMemo(() => new Map(pts.map((p, i) => [p[0], i])), [pts]);
  const base = (Math.min(size.w, size.h) / 1000) * 0.94;
  const ox = (size.w - 1000 * base) / 2;
  const oy = (size.h - 1000 * base) / 2;
  const sx = useCallback((x) => ox + x * base * view.s + view.tx, [ox, base, view]);
  const sy = useCallback((y) => oy + y * base * view.s + view.ty, [oy, base, view]);

  // stage membership for every traced id
  const roles = useMemo(() => {
    if (!trace) return null;
    const r = new Map();
    const add = (id, k, v) => {
      if (!r.has(id)) r.set(id, {});
      r.get(id)[k] = v;
    };
    trace.bm25?.forEach((h, i) => add(h.id, "bm25", i + 1));
    trace.semantic?.forEach((h, i) => h.kept && add(h.id, "semantic", i + 1));
    trace.fused?.forEach((h, i) => add(h.id, "fused", i + 1));
    trace.rerank?.forEach((h, i) => add(h.id, "rerank", h.score));
    trace.hits?.forEach((h, i) => add(h.id, "final", { n: i + 1, pass: h.pass }));
    return r;
  }, [trace]);

  // where the question sits: on the map's projection the nearest section by cosine is the
  // honest anchor (UMAP cannot place a new vector exactly; an average lands in empty space)
  const qpos = useMemo(() => {
    const top = trace?.semantic?.[0];
    const i = top && byId.get(top.id);
    return i === undefined || !top ? null : [pts[i][1], pts[i][2]];
  }, [trace, byId, pts]);

  // frame the question and every result when a new trace arrives
  const frame = useCallback(() => {
    if (!qpos) return;
    const xs = [qpos[0]], ys = [qpos[1]];
    for (const h of trace?.hits || []) {
      const i = byId.get(h.id);
      if (i !== undefined) { xs.push(pts[i][1]); ys.push(pts[i][2]); }
    }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = 70;
    const s = Math.min(6, Math.max(1, Math.min((size.w - pad * 2) / ((x1 - x0) * base || 1), (size.h - pad * 2) / ((y1 - y0) * base || 1))));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    setView({ s, tx: size.w / 2 - ox - cx * base * s, ty: size.h / 2 - oy - cy * base * s });
  }, [qpos, trace, byId, pts, size, base, ox, oy]);
  useEffect(() => {
    frame();
  }, [qpos]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useCallback(
    (role) => {
      if (!role) return false;
      if (stage === "all") return true;
      return role[stage] !== undefined;
    },
    [stage],
  );

  useEffect(() => {
    const c = cvs.current;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const r0 = Math.min(3.6, 2.1 + view.s * 0.3);
    // every section
    for (const p of pts) {
      const x = sx(p[1]), y = sy(p[2]);
      if (x < -4 || y < -4 || x > size.w + 4 || y > size.h + 4) continue;
      g.fillStyle = inkOf(map.types[p[3]]);
      g.globalAlpha = roles ? 0.28 : map.docs[p[4]].cancelled ? 0.4 : 0.9;
      g.fillRect(x - r0 / 2, y - r0 / 2, r0, r0);
    }
    g.globalAlpha = 1;
    // the question marker never leaves the map: clamped to the edge (16 px in), and its lines start there
    const qx = qpos ? Math.min(size.w - 16, Math.max(16, sx(qpos[0]))) : 0;
    const qy = qpos ? Math.min(size.h - 16, Math.max(16, sy(qpos[1]))) : 0;
    if (roles && qpos && (stage === "all" || stage === "final")) {
      g.save();
      g.setLineDash([4, 4]);
      g.lineWidth = 1;
      for (const h of trace.hits || []) {
        const i = byId.get(h.id);
        if (i === undefined) continue;
        g.strokeStyle = h.pass ? STAGE_INK.final : FAIL_INK;
        g.globalAlpha = h.pass ? 0.85 : 0.45;
        g.beginPath();
        g.moveTo(qx, qy);
        g.lineTo(sx(pts[i][1]), sy(pts[i][2]));
        g.stroke();
      }
      g.restore();
    }
    if (roles) {
      const order = [...roles.entries()].sort((a, b) => (a[1].final ? 1 : 0) - (b[1].final ? 1 : 0));
      for (const [id, role] of order) {
        const i = byId.get(id);
        if (i === undefined || !shown(role)) continue;
        const x = sx(pts[i][1]), y = sy(pts[i][2]);
        if (role.final && (stage === "all" || stage === "final")) {
          g.fillStyle = role.final.pass ? STAGE_INK.final : FAIL_INK;
          g.strokeStyle = "#fff";
          g.lineWidth = 2;
          g.fillRect(x - 11, y - 11, 22, 22);
          g.strokeRect(x - 11, y - 11, 22, 22);
          g.fillStyle = "#fff";
          g.font = "600 13px 'IBM Plex Sans Thai', sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText((role.final.pass ? "✓" : "") + thai(role.final.n), x, y + 0.5);
          continue;
        }
        const dot = (col, r, shape) => {
          g.fillStyle = col;
          g.strokeStyle = "#fff";
          g.lineWidth = 1.5;
          g.beginPath();
          if (shape === "sq") g.rect(x - r, y - r, r * 2, r * 2);
          else if (shape === "dia") { g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y); g.lineTo(x, y + r + 1); g.lineTo(x - r - 1, y); g.closePath(); }
          else g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        };
        if (role.rerank !== undefined && (stage === "all" || stage === "rerank")) {
          dot(STAGE_INK.rerank, 4 + 6 * Math.max(0, role.rerank));
          continue;
        }
        if (stage === "fused" && role.fused !== undefined) {
          dot(STAGE_INK.fused, 5, "dia");
          continue;
        }
        if (role.semantic !== undefined && (stage === "all" || stage === "semantic")) dot(STAGE_INK.semantic, 5);
        if (role.bm25 !== undefined && (stage === "all" || stage === "bm25")) dot(STAGE_INK.bm25, 4, "sq");
      }
    }
    if (qpos) {
      const x = qx, y = qy;
      g.strokeStyle = "#1a1d1b";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 12, y); g.lineTo(x - 4, y); g.moveTo(x + 4, y); g.lineTo(x + 12, y);
      g.moveTo(x, y - 12); g.lineTo(x, y - 4); g.moveTo(x, y + 4); g.lineTo(x, y + 12);
      g.stroke();
    }
    for (const [id, col] of [[picked, "#1a1d1b"], [hover, "#1a1d1b"]]) {
      const i = id && byId.get(id);
      if (i === undefined || !id) continue;
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx(pts[i][1]), sy(pts[i][2]), 13, 0, Math.PI * 2);
      g.stroke();
    }
  }, [pts, map, trace, size, view, roles, stage, shown, qpos, hover, picked, sx, sy, byId]);

  const nearest = (mx, my) => {
    let best = null, bd = 100; // 10 px
    const look = roles ? [...roles.keys()].map((id) => byId.get(id)).filter((i) => i !== undefined && shown(roles.get(pts[i][0]))) : null;
    const scan = (i) => {
      const dx = sx(pts[i][1]) - mx, dy = sy(pts[i][2]) - my, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = pts[i][0]; }
    };
    if (look) look.forEach(scan);
    if (!best) for (let i = 0; i < pts.length; i++) scan(i);
    return best;
  };

  const onMove = (e) => {
    const b = cvs.current.getBoundingClientRect();
    const mx = e.clientX - b.left, my = e.clientY - b.top;
    if (drag.current) {
      const d = drag.current;
      if (Math.abs(mx - d.x) + Math.abs(my - d.y) > 3) d.moved = true;
      setView((v) => ({ ...v, tx: d.tx + mx - d.x, ty: d.ty + my - d.y }));
      return;
    }
    setHover(nearest(mx, my), { x: mx, y: my });
  };
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const b = cvs.current.getBoundingClientRect();
    const mx = e.clientX - b.left, my = e.clientY - b.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const s = Math.min(Math.max(v.s * f, 0.8), 40), k = s / v.s;
      return { s, tx: mx - ox - (mx - ox - v.tx) * k, ty: my - oy - (my - oy - v.ty) * k };
    });
  }, [ox, oy]);
  useEffect(() => {
    const c = cvs.current;
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  return (
    <div ref={wrap} className="relative">
      <canvas
        ref={cvs}
        style={{ width: size.w, height: size.h }}
        className={`block touch-none bg-sheet ${hover != null ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
        role="img"
        aria-label={`แผนที่ ${num(pts.length)} ข้อ/ส่วน จัดวางตามความหมาย`}
        onPointerDown={(e) => {
          const b = cvs.current.getBoundingClientRect();
          drag.current = { x: e.clientX - b.left, y: e.clientY - b.top, tx: view.tx, ty: view.ty, moved: false };
          cvs.current.setPointerCapture(e.pointerId);
        }}
        onPointerMove={onMove}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const b = cvs.current.getBoundingClientRect();
            const id = nearest(e.clientX - b.left, e.clientY - b.top);
            if (id) pick(id);
          }
        }}
        onPointerLeave={() => !drag.current && setHover(null)}
        onDoubleClick={() => setView({ s: 1, tx: 0, ty: 0 })}
      />
      <div className="absolute right-2 top-2 flex gap-1">
        {qpos && (
          <button
            type="button"
            title="ไปที่คำถาม"
            onClick={frame}
            className="inline-flex h-9 items-center gap-1 border border-form bg-sheet px-2 text-[13px] text-form hover:bg-tint"
          >
            <LocateFixed className="h-3.5 w-3.5" /> คำถามและผล
          </button>
        )}
        <button
          type="button"
          onClick={() => setView({ s: 1, tx: 0, ty: 0 })}
          className="h-9 border border-form bg-sheet px-2 text-[13px] text-form hover:bg-tint"
        >
          ทั้งแผนที่
        </button>
      </div>
    </div>
  );
}

/* ---------- side panel: the pipeline ---------- */

function Bar({ v, max = 1, color }) {
  const w = Math.max(2, Math.min(100, (v / (max || 1)) * 100));
  return (
    <span className="relative block h-2 w-full bg-tint">
      <span className="absolute inset-y-0 left-0" style={{ width: `${w}%`, background: color }} />
    </span>
  );
}

function Rows({ items, info, hover, setHover, pick, score, max, color }) {
  const [all, setAll] = useState(false);
  const list = all ? items : items.slice(0, 6);
  return (
    <>
      <ol className="mt-1.5">
        {list.map((h, i) => {
          const m = info(h.id);
          return (
            <li key={h.id}>
              <button
                type="button"
                onMouseEnter={() => setHover(h.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(h.id)}
                onBlur={() => setHover(null)}
                onClick={() => pick(h.id)}
                className={`grid w-full grid-cols-[1.6rem_1fr_4.6rem] items-start gap-x-2 py-1.5 text-left text-[14px] leading-5 ${hover === h.id ? "bg-mark-wash" : "hover:bg-tint"}`}
              >
                <span className="tnum pt-px text-right text-form-soft">{thai(i + 1)}</span>
                <span className="min-w-0" title={m ? `${m.title} ${m.section}` : h.id}>
                  <span className="line-clamp-2 text-ink">{m ? m.title : h.id}</span>
                  {m?.section && <span className="block text-[13px] text-ink-soft">{m.section}</span>}
                </span>
                <span className="flex flex-col items-end gap-1 pt-px">
                  <span className="tnum text-[13px] text-ink">{score(h)}</span>
                  <Bar v={h._v ?? 0} max={max} color={typeof color === "function" ? color(h) : color} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {items.length > 6 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 min-h-8 text-[13px] text-form underline underline-offset-2 hover:text-ink">
          {all ? "ย่อ" : `ดูทั้งหมด ${thai(items.length)} รายการ`}
        </button>
      )}
    </>
  );
}

/* how the words are cut: the index uses character trigrams; ICU (what relic5 uses,
   here through the browser's Intl.Segmenter) cuts real Thai words */
function Tokens({ q, tri }) {
  const words = useMemo(() => {
    try {
      return [...new Intl.Segmenter("th", { granularity: "word" }).segment(q)].filter((x) => x.isWordLike).map((x) => x.segment);
    } catch {
      return [];
    }
  }, [q]);
  const [open, setOpen] = useState(false);
  const chip = "inline-block border border-rule bg-sheet px-1 leading-5";
  return (
    <div className="mt-1.5 text-[13px] leading-6">
      <div className="text-form-soft">ตัดคำแบบ ICU (คำไทยจริง {thai(words.length)} คำ · ใช้เปรียบเทียบเท่านั้น)</div>
      <div className="flex flex-wrap gap-1">{words.map((w, i) => <span key={i} className={chip}>{w}</span>)}</div>
      <div className="mt-1 text-form-soft">ตัดแบบ trigram ที่ดัชนีใช้จริง ({thai(tri.length)} ชิ้น ทีละ ๓ ตัวอักษร เลื่อนทีละตัว)</div>
      <div className="flex flex-wrap gap-1">
        {(open ? tri : tri.slice(0, 18)).map((w) => <span key={w} className={`${chip} text-ink-soft`}>{w}</span>)}
        {tri.length > 18 && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-form underline underline-offset-2">
            {open ? "ย่อ" : `+${thai(tri.length - 18)}`}
          </button>
        )}
      </div>
    </div>
  );
}

function Pipeline({ trace, info, stage, setStage, hover, setHover, pick }) {
  if (!trace) return null;
  const sem = trace.semantic || [];
  const kept = sem.filter((h) => h.kept);
  const bmMax = Math.max(...(trace.bm25 || []).map((h) => h.score), 1);
  const stageData = {
    bm25: { items: (trace.bm25 || []).map((h) => ({ ...h, _v: h.score })), score: (h) => `${h.score.toFixed(1)} · ${Math.round(h.share * 100)}%`, max: bmMax, count: trace.bm25?.length || 0, ms: trace.ms_bm25 },
    semantic: { items: kept.map((h) => ({ ...h, _v: h.cos })), score: (h) => h.cos.toFixed(3), max: 1, count: kept.length, extra: sem.length - kept.length, ms: undefined },
    fused: { items: (trace.fused || []).map((h) => ({ ...h, _v: h.rrf })), score: (h) => h.rrf.toFixed(4), max: Math.max(...(trace.fused || []).map((h) => h.rrf), 0.001), count: trace.fused?.length || 0, ms: trace.ms_fused },
    rerank: { items: (trace.rerank || []).map((h) => ({ ...h, _v: h.score })), score: (h) => h.score.toFixed(3), max: 1, count: trace.rerank?.length || 0, ms: trace.ms_rerank, color: (h) => (h.score >= trace.gate.rerank ? STAGE_INK.final : "#8b938e") },
    final: { items: (trace.hits || []).filter((h) => h.pass).map((h) => ({ ...h, _v: h.rerank })), score: (h) => (h.rerank ?? 0).toFixed(3), max: 1, count: (trace.hits || []).filter((h) => h.pass).length },
  };
  return (
    <div>
      <section className="border-b border-rule px-4 py-3">
        <div className="text-[14px] font-medium text-form">{thai(1)} คำถามที่ระบบใช้ค้น</div>
        <p className="mt-1 text-[14px] leading-6 text-ink">{trace.query}</p>
        {trace.expanded?.length > 0 && (
          <p className="mt-1 text-[13.5px] leading-5 text-ink-soft">
            เติมคำกฎหมาย: <span className="text-ink">{trace.expanded.join(" · ")}</span>
          </p>
        )}
        <Tokens q={trace.query} tri={trace.tokens || []} />
        {trace.qvec && (
          <p className="mt-1.5 bg-tint px-2 py-1 font-mono text-[12.5px] leading-5 text-ink-soft tnum">
            [{trace.qvec.map((x) => x.toFixed(4)).join(", ")}, …]
            <span className="block font-ui text-form-soft">เวกเตอร์ของคำถาม · {num(trace.dims)} มิติ (แสดง ๘ ตัวแรก)</span>
          </p>
        )}
        <p className="mt-1 text-[13px] leading-5 text-form-soft tnum">
          ตัดเป็น {num(trace.tokens?.length || 0)} trigram (มีในคลัง {num(trace.tokens_known || 0)}) · รวม {num(trace.ms)} ms
        </p>
        {trace.semantic_error && <p className="mt-1 text-[13px] text-stamp">ค้นตามความหมายไม่ได้: {trace.semantic_error}</p>}
      </section>
      {STAGES.map((s) => {
        const d = stageData[s.key];
        const on = stage === s.key;
        return (
          <section key={s.key} className="border-b border-rule px-4 py-3" style={{ borderLeft: `4px solid ${STAGE_INK[s.key]}`, background: on ? "var(--color-tint)" : undefined }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold leading-6" style={{ color: STAGE_INK[s.key] }}>
                  {thai(s.n)} {s.label}
                </div>
                <div className="tnum text-[13px] text-ink-soft">
                  {s.tech} · {thai(d.count)} รายการ{d.ms !== undefined ? ` · ${num(d.ms)} ms` : ""}
                </div>
              </div>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setStage(on ? "all" : s.key)}
                className={`inline-flex min-h-8 shrink-0 items-center gap-1 border px-2 text-[13px] ${on ? "border-ink bg-ink text-sheet" : "border-rule bg-sheet text-ink hover:border-ink"}`}
              >
                <Filter className="h-3.5 w-3.5" /> {on ? "แสดงทุกขั้น" : "ดูบนแผนที่"}
              </button>
            </div>
            <p className="mt-0.5 text-[13px] leading-5 text-form-soft">
              {s.note}
              {d.extra ? ` · ตัด ${thai(d.extra)} รายการที่ cosine ต่ำกว่า ${trace.min_cosine}` : ""}
            </p>
            {d.count === 0 ? (
              <p className={`mt-1.5 text-[14px] ${s.key === "final" ? "font-medium text-stamp" : "text-ink-soft"}`}>
                {s.key === "final" ? "ไม่มีส่วนใดผ่านเกณฑ์ → ระบบไม่ตอบ (ไม่เดา)" : "ไม่มี"}
              </p>
            ) : (
              <Rows items={d.items} info={info} hover={hover} setHover={setHover} pick={pick} score={d.score} max={d.max} color={d.color || STAGE_INK[s.key]} />
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ---------- picked section: its text ---------- */

function Picked({ id, info, close }) {
  const [sec, setSec] = useState(null);
  const m = info(id);
  useEffect(() => {
    setSec(null);
    if (!m) return;
    let live = true;
    fetch(`/api/doc?key=${encodeURIComponent(m.key)}`)
      .then((r) => r.json())
      .then((d) => live && setSec({ ...(d.sections || []).find((s) => s.id === id), url: d.source_url }))
      .catch(() => live && setSec({ error: true }));
    return () => {
      live = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  return (
    <section className="border-t-2 border-form" aria-live="polite">
      <div className="flex items-start justify-between gap-3 bg-tint px-4 py-2">
        <div className="min-w-0">
          <div className="text-[13px] text-form-soft">
            {m.type} · พ.ศ. {thai(m.year)}
            {m.cancelled && <span className="ml-2 font-medium text-stamp">ยกเลิกแล้ว</span>}
          </div>
          <div className="text-[14px] font-medium leading-6 text-ink">{m.title}</div>
          <div className="text-[14px] text-ink-soft">
            {m.section || "—"}
            {sec?.pages ? ` · หน้า ${sec.pages}` : ""}
          </div>
        </div>
        <button type="button" onClick={close} aria-label="ปิด" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-form hover:bg-sheet">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-72 overflow-auto px-4 py-3">
        {!sec ? (
          <div className="pending h-16 bg-tint" />
        ) : sec.error ? (
          <p className="text-[14px] text-ink-soft">โหลดข้อความไม่ได้</p>
        ) : (
          <p className="max-w-[68ch] whitespace-pre-line font-law text-[16px] leading-[1.8] text-ink">{sec.text}</p>
        )}
      </div>
      {sec?.url && (
        <a href={sec.url} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-1.5 border-t border-rule px-4 text-[14px] text-form hover:text-ink">
          <ExternalLink className="h-3.5 w-3.5" /> PDF ต้นฉบับ
        </a>
      )}
    </section>
  );
}

/* ---------- page ---------- */

export default function Explorer() {
  const map = useMap();
  const [q, setQ] = useState("");
  const [trace, setTrace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("all");
  const [hover, setHoverId] = useState(null);
  const [tip, setTip] = useState(null);
  const [picked, setPicked] = useState(null);
  const [popular, setPopular] = useState(null);
  useEffect(() => {
    fetch("/api/popular?k=12&test=1")
      .then((r) => r.json())
      .then(setPopular)
      .catch(() => {});
  }, []);

  const info = useMemo(() => {
    if (!map?.points) return () => null;
    const m = new Map(map.points.map((p) => [p[0], p]));
    return (id) => {
      const p = m.get(id);
      if (!p) return null;
      const d = map.docs[p[4]];
      return { ...d, type: map.types[p[3]], section: p[5] };
    };
  }, [map]);

  const setHover = useCallback((id, at) => {
    setHoverId(id);
    setTip(id && at ? at : null);
  }, []);

  const run = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ(question);
    setBusy(true);
    setPicked(null);
    setStage("all");
    try {
      const r = await fetch(`/api/trace?q=${encodeURIComponent(question)}`);
      setTrace(r.ok ? await r.json() : null);
    } finally {
      setBusy(false);
    }
  };

  const ranks = (id) => {
    if (!trace) return [];
    const out = [];
    const b = trace.bm25?.findIndex((h) => h.id === id);
    if (b >= 0) out.push(`คำ #${b + 1}`);
    const s = trace.semantic?.find((h) => h.id === id);
    if (s?.kept) out.push(`ความหมาย #${trace.semantic.indexOf(s) + 1} (${s.cos.toFixed(2)})`);
    const r = trace.rerank?.find((h) => h.id === id);
    if (r) out.push(`rerank ${r.score.toFixed(2)}`);
    const f = trace.hits?.find((h) => h.id === id);
    if (f?.pass) out.push("ผ่านเกณฑ์");
    return out;
  };

  const counts = useMemo(() => {
    if (!map?.points) return [];
    const c = {};
    for (const p of map.points) c[map.types[p[3]]] = (c[map.types[p[3]]] || 0) + 1;
    const big = Object.keys(TYPE_INK).filter((t) => c[t]).map((t) => [t, c[t]]);
    const other = Object.entries(c).filter(([t]) => !TYPE_INK[t]).reduce((a, [, n]) => a + n, 0);
    return other ? [...big, ["อื่น ๆ", other]] : big;
  }, [map]);

  const tipInfo = hover && tip ? info(hover) : null;

  return (
    <div className="min-h-screen px-0 sm:px-6 sm:pb-6">
      <Nav here="map" wide />
      <main className="mx-auto max-w-[90rem] border-form bg-sheet shadow-[0_2px_14px_rgb(20_40_30/0.10)] sm:border">
        <header className="border-b-2 border-form">
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-8">
            <div className="min-w-0">
              <h1 className="text-[22px] leading-8 font-semibold text-form sm:text-[26px]">
                แผนที่ข้อมูล<span className="whitespace-nowrap"> · ระบบค้นทำงานอย่างไร</span>
              </h1>
              <p className="mt-1 max-w-[60rem] text-[14px] leading-6 text-ink-soft">
                ทุกจุดคือหนึ่งข้อ/ส่วนของเอกสาร วางตามความหมายของเวกเตอร์ที่สร้างไว้ล่วงหน้า (จุดที่อยู่ใกล้กันพูดเรื่องใกล้กัน)
                พิมพ์คำถามเพื่อดูว่าแต่ละขั้นของการค้นหยิบส่วนไหนมา
              </p>
            </div>
            <div className="shrink-0 border border-form px-2.5 py-1.5 text-right text-[13px] leading-5 text-form">
              สำหรับ
              <br />
              <span className="text-form-soft">เจ้าหน้าที่</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule bg-tint px-5 py-1.5 text-[13px] text-ink-soft sm:px-8 tnum">
            {map?.points ? (
              <>
                <span>{num(map.docs.length)} เอกสาร</span>
                <span>{num(map.n)} ข้อ/ส่วน (ยาวเฉลี่ย {num(map.chars_avg)} ตัวอักษร · กลาง {num(map.chars_median)} · ยาวสุด {num(map.chars_max)})</span>
                <span>เวกเตอร์ embeddinggemma ๗๖๘ มิติ</span>
                <span>คำ (trigram) ในดัชนี {num(map.vocab)}</span>
                <span>แผนที่ UMAP สร้างเมื่อ {map.built}</span>
              </>
            ) : (
              <span className={map?.error ? "text-stamp" : ""}>{map?.error ? `ยังไม่มีแผนที่: ${map.error}` : "กำลังโหลดแผนที่…"}</span>
            )}
          </div>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="border-b border-rule px-5 py-3 sm:px-8"
        >
          <label htmlFor="xq" className="text-[14px] font-medium text-form">
            คำถาม
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="xq"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="เช่น ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม"
              className="dotline min-h-11 min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-soft/60"
            />
            <button
              type="submit"
              disabled={busy || !q.trim()}
              className="inline-flex h-11 items-center gap-1.5 bg-form px-4 text-[14px] text-sheet hover:bg-ink disabled:bg-rule disabled:text-ink-soft"
            >
              <Search className="h-4 w-4" /> {busy ? "กำลังค้น…" : "ค้น"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => run(e)} className="min-h-8 text-[14px] text-form underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-form">
                {e}
              </button>
            ))}
          </div>
        </form>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0 self-start border-b border-rule lg:sticky lg:top-0 lg:border-r lg:border-b-0">
            {map?.points ? (
              <div className="relative">
                <MapCanvas map={map} trace={trace} stage={stage} hover={hover} setHover={setHover} pick={setPicked} picked={picked} />
                {tipInfo && (
                  <div
                    className="pointer-events-none absolute z-10 max-w-[22rem] border border-form bg-sheet px-2.5 py-1.5 text-[13px] leading-5 shadow-[0_4px_16px_rgb(20_40_30/0.18)]"
                    style={{ left: Math.min(tip.x + 14, 9999), top: tip.y + 14 }}
                  >
                    <div className="text-form-soft">
                      {tipInfo.type} · {thai(tipInfo.year)}
                      {tipInfo.cancelled && <span className="ml-1.5 text-stamp">ยกเลิกแล้ว</span>}
                    </div>
                    <div className="font-medium text-ink">{tipInfo.title}</div>
                    <div className="text-ink-soft">{tipInfo.section || "—"}</div>
                    {ranks(hover).length > 0 && <div className="mt-0.5 font-medium text-ink">{ranks(hover).join(" · ")}</div>}
                  </div>
                )}
              </div>
            ) : (
              <div className="pending m-5 h-[28rem] bg-tint" />
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule px-4 py-2 text-[13px] text-ink-soft">
              {trace ? (
                <>
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5" style={{ background: STAGE_INK.bm25 }} />๒ ค้นตามคำ</span>
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STAGE_INK.semantic }} />๓ ค้นตามความหมาย</span>
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: STAGE_INK.fused }} />๔ รวมสองรายการ</span>
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-full" style={{ background: STAGE_INK.rerank }} />๕ อ่านทวน (ใหญ่ = คะแนนสูง)</span>
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3" style={{ background: STAGE_INK.final }} />✓ ผ่านเกณฑ์</span>
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3" style={{ background: FAIL_INK }} />ไม่ผ่าน</span>
                  <span>✛ คำถาม</span>
                  <span className="basis-full text-form-soft">ระยะบนแผนที่เป็นค่าประมาณจากการย่อ ๗๖๘ มิติเหลือ ๒ มิติ ดูคะแนนจริงในแผงขวา</span>
                </>
              ) : (
                counts.map(([t, n]) => (
                  <span key={t} className="inline-flex items-center gap-1.5 tnum">
                    <i className="inline-block h-2.5 w-2.5" style={{ background: TYPE_INK[t] || OTHER_INK }} />
                    {t} {num(n)}
                  </span>
                ))
              )}
              <span className="ml-auto text-form-soft">ลากเพื่อเลื่อน · หมุนล้อเพื่อซูม · คลิกจุดเพื่ออ่าน</span>
            </div>
            {picked && <Picked id={picked} info={info} close={() => setPicked(null)} />}
          </div>
          <aside aria-label="ขั้นตอนการค้น">
            {trace ? (
              <Pipeline trace={trace} info={info} stage={stage} setStage={setStage} hover={hover} setHover={(id) => setHover(id, null)} pick={setPicked} />
            ) : (
              <div className="px-4 py-4 text-[14px] leading-7 text-ink-soft">
                <p className="text-[14px] font-medium text-form">ขั้นตอนการค้น</p>
                <ol className="mt-1 list-none">
                  <li>{thai(1)} ตัดคำถามเป็นคำ และเติมคำกฎหมาย</li>
                  {STAGES.map((s) => (
                    <li key={s.key}>
                      {thai(s.n)} {s.label}
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[14px]">เลือกตัวอย่างหรือพิมพ์คำถามด้านบน</p>
                {popular?.topics?.length > 0 && (
                  <div className="mt-5">
                    <p className="text-[14px] font-semibold text-form">หัวข้อที่ถามบ่อย (รวมคำถามทดสอบ)</p>
                    <p className="text-[13px] text-ink-soft">{num(popular.total)} คำถาม · {num(popular.distinct)} แบบ · จัดกลุ่มด้วยเวกเตอร์ (cosine ≥ 0.80)</p>
                    <ol className="mt-1.5">
                      {popular.topics.map((t) => (
                        <li key={t.label}>
                          <button type="button" onClick={() => run(t.label)} className="grid w-full grid-cols-[1fr_auto] gap-x-2 py-1.5 text-left text-[14px] leading-5 hover:bg-tint">
                            <span className="text-ink">{t.label}{t.variants.length > 0 && <span className="block text-[13px] text-ink-soft">+{thai(t.variants.length)} แบบ: {t.variants.join(" · ")}</span>}</span>
                            <span className="tnum text-right text-[13px]">
                              <span className="block font-semibold text-ink">{thai(t.asked)}×</span>
                              <span className={t.answered ? "text-ink-soft" : "font-semibold text-stamp"}>{t.answered ? `${thai(Math.round(t.answer_rate * 100))}%` : "ไม่ตอบ"}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
