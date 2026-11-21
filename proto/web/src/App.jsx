import Front from "./Front.jsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Explorer from "./Explorer.jsx";
import Nav from "./Nav.jsx";
import ChatWidget from "./ChatWidget.jsx";
import Home from "./Home.jsx";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  SearchX,
  SendHorizontal,
  UserCog,
  X,
} from "lucide-react";

const EXAMPLES = [
  "เปิดโรงเบียร์ขนาดเล็กต้องขออนุญาตอะไรบ้าง",
  "อัตราภาษีเบียร์ตอนนี้เท่าไร",
  "ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม",
  "ค่าธรรมเนียมใบอนุญาตผลิตเบียร์เท่าไร",
  "ต้องขออนุมัติฉลากเบียร์ก่อนขายไหม",
  "ต้องปิดแสตมป์สุราให้หมดในครั้งเดียวไหม",
];

const TH = "๐๑๒๓๔๕๖๗๘๙";
const thai = (n) => String(n).replace(/\d/g, (d) => TH[d]);
const today = new Date().toISOString().slice(0, 10);
const isCancelled = (h) => Boolean(h.cancelled || (h.cancel && h.cancel.slice(0, 10) <= today));
const thDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
};
const pageLabel = (h) => h.pages || h.page;

/* ---------- small printed parts of the form ---------- */

function Label({ n, children, className = "" }) {
  return (
    <div className={`flex items-baseline gap-2 text-[14px] font-semibold text-form ${className}`}>
      {n != null && <span className="tnum">{thai(n)}.</span>}
      <span>{children}</span>
    </div>
  );
}

function Box({ checked, tone = "form" }) {
  const c = tone === "stamp" ? "border-stamp text-stamp" : "border-form text-form";
  return (
    <span className={`inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center border ${c} bg-sheet`} aria-hidden>
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <div className={`min-w-0 border-rule px-3 py-2 ${className}`}>
      <div className="text-[13px] leading-5 text-form-soft">{label}</div>
      <div className="tnum min-w-0 text-[15px] leading-6 text-ink">{children}</div>
    </div>
  );
}

/* ---------- the form header ---------- */

function Header({ health, staff, setStaff }) {
  const status = health?.error
    ? { t: "เซิร์ฟเวอร์ยังไม่พร้อม กำลังลองใหม่ (เริ่มเครื่องใช้ราว 1 นาที)", c: "text-stamp" }
    : health
      ? {
          t:
            `${health.docs.toLocaleString("th-TH")} เอกสาร · ${health.chunks.toLocaleString("th-TH")} ข้อ/ส่วน` +
            (health.hosted ? " · ฉบับออนไลน์" : ""),
          c: "text-ink-soft",
        }
      : { t: "กำลังเชื่อมต่อ…", c: "text-ink-soft" };
  return (
    <header className="border-b-2 border-form">
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-8 font-semibold text-form sm:text-[26px]">แบบสอบถาม<span className="whitespace-nowrap">ข้อกฎหมายสรรพสามิต</span></h1>
          <p className="mt-1 text-[14px] leading-6 text-ink-soft">
            สำหรับผู้ผลิตคราฟต์เบียร์ · ตอบด้วยข้อความจากเอกสารกรมสรรพสามิตในคลังเท่านั้น พร้อมที่มาให้ตรวจเองได้
          </p>
        </div>
        <div className="shrink-0 border border-form px-2.5 py-1.5 text-right text-[13px] leading-5 text-form">
          ต้นแบบ
          <br />
          <span className="text-form-soft">ยังไม่ใช่คำแนะนำ</span>
          <br />
          <span className="text-form-soft">ทางกฎหมาย</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-rule bg-tint px-5 py-1.5 text-[13px] sm:px-8">
        <span className={`tnum ${status.c}`}>{status.t}</span>
        <button
          type="button"
          onClick={() => setStaff((s) => !s)}
          aria-pressed={staff}
          className="inline-flex min-h-11 items-center gap-1.5 text-form hover:text-ink sm:min-h-8"
        >
          <Box checked={staff} />
          <UserCog className="h-3.5 w-3.5" />
          สำหรับเจ้าหน้าที่ (ดูคะแนน / เทียบผล)
        </button>
      </div>
    </header>
  );
}

/* ---------- section 1: the question ---------- */

/* frequent topics: logged questions grouped by meaning on the server (/api/popular).
   Members see real traffic only; with the staff box ticked, test questions count too. */
function Popular({ ask }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    const staff = localStorage.getItem("staff") === "1";
    fetch(`/api/popular?k=6&test=${staff ? 1 : 0}`)
      .then((r) => r.json())
      .then(setP)
      .catch(() => setP(null));
  }, []);
  if (!p?.topics?.length) return null;
  return (
    <section className="mt-6" aria-label="หัวข้อที่ถามบ่อย">
      <h2 className="text-[14px] font-semibold text-form">หัวข้อที่ถามบ่อย <span className="font-normal text-ink-soft">(เห็นเฉพาะเจ้าหน้าที่ รวมคำถามทดสอบ)</span></h2>
      <p className="text-[13px] text-ink-soft">จัดกลุ่มคำถามที่ความหมายใกล้กัน · {p.total.toLocaleString("th-TH")} คำถาม</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {p.topics.map((t) => (
          <li key={t.label} className="min-w-0">
            <button
              type="button"
              onClick={() => ask(t.label)}
              className="flex w-full items-start justify-between gap-3 border border-rule bg-sheet px-3 py-2 text-left hover:border-form hover:bg-tint"
            >
              <span className="min-w-0">
                <span className="block text-[15px] leading-6 text-ink">{t.label}</span>
                {t.variants.length > 0 && <span className="block truncate text-[13px] text-ink-soft">หรือ: {t.variants.join(" · ")}</span>}
              </span>
              <span className="shrink-0 text-right text-[13px] leading-5 tnum">
                <span className="block font-semibold text-form">{t.asked} ครั้ง</span>
                <span className={t.answered ? "text-ink-soft" : "font-semibold text-stamp"}>{t.answered ? `ตอบได้ ${Math.round(t.answer_rate * 100)}%` : "ยังตอบไม่ได้"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* live hint while typing: which legal words the search will add, so the member sees how
   their everyday words are read before sending */
function useTermHint(q) {
  const [hint, setHint] = useState([]);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) {
      setHint([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/terms?q=${encodeURIComponent(text)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => setHint(d.added || []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);
  return hint;
}

/* The follow-up box: docked small at the right while reading, and as the page end comes into
   view it grows back, step by step with the scroll, into the full card in the middle. */
const DOCK_W = 360; // px, the docked width
const MORPH = 360; // px of scroll before the end over which it morphs
function FloatingAsk(props) {
  const wrap = useRef(null);
  const [m, setM] = useState({ p: 1, full: 736, shift: 0, on: false });
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = wrap.current;
      if (!el) return;
      // follows the scroll by hand (no autoplay), so it stays on under reduced motion
      const on = window.innerWidth >= 768;
      const box = el.getBoundingClientRect();
      const full = Math.min(736, box.width);
      const left = document.scrollingElement;
      const d = left.scrollHeight - (window.scrollY + window.innerHeight);
      const p = on ? Math.min(1, Math.max(0, 1 - (d - 24) / MORPH)) : 1; // full a little before the very end
      // docked: right edge of the box sits near the right edge of the window, outside the sheet
      const shift = on ? Math.max(0, window.innerWidth - 24 - (box.left + box.width / 2 + full / 2)) : 0;
      setM({ p, full, shift, on });
    };
    const on = () => raf || (raf = requestAnimationFrame(measure));
    measure();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    const ro = new ResizeObserver(on);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  const e = m.p * m.p * (3 - 2 * m.p); // smoothstep: eases in and out of the morph
  const w = m.on ? DOCK_W + (m.full - DOCK_W) * e : m.full;
  // centre of the card moves from the docked spot (right) to the middle of the column
  const dx = m.on ? (1 - e) * ((m.full - w) / 2 + m.shift) : 0;
  const docked = m.on && e < 0.5;
  return (
    <div ref={wrap} className="pointer-events-none sticky bottom-0 z-10 px-3 pt-6 pb-3 sm:px-6 sm:pb-5">
      <div
        className="pointer-events-auto mx-auto border-2 border-form bg-sheet shadow-[0_10px_28px_rgb(10_30_20/0.22)]"
        style={{ width: m.on ? w : undefined, maxWidth: m.on ? undefined : "46rem", transform: `translateX(${dx}px)`, willChange: "transform, width" }}
      >
        <Ask {...props} first={false} compact={docked} />
      </div>
    </div>
  );
}

function Ask({ q, setQ, ask, busy, first, compact = false, embedExamples = false }) {
  const ref = useRef(null);
  const hint = useTermHint(q);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [q]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        ask();
      }}
      className={first ? "px-5 py-5 sm:px-8" : "px-4 py-3 sm:px-5"}
    >
      <Label n={first ? 1 : null} className={first ? "" : compact ? "sr-only" : "sr-only sm:not-sr-only"}>
        <label htmlFor="q">{first ? "คำถามของท่าน (พิมพ์ภาษาธรรมดาได้)" : "ถามต่อ"}</label>
      </Label>
      <div className="mt-2 flex items-end gap-3">
        <textarea
          id="q"
          ref={ref}
          rows={1}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder={first ? "เช่น ภาษีเบียร์คิดเท่าไร" : "พิมพ์คำถามถัดไป…"}
          className="dotline min-h-11 flex-1 resize-none bg-transparent pb-1.5 text-[18px] leading-8 text-ink outline-none placeholder:text-ink-soft/70 focus-visible:outline-none"
        />
        <button
          disabled={busy || !q.trim()}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 bg-form px-4 text-[15px] font-medium text-sheet transition-colors hover:bg-ink disabled:border disabled:border-rule disabled:bg-sheet disabled:text-ink-soft"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          <span className={compact ? "sr-only" : ""}>ส่งคำถาม</span>
        </button>
      </div>
      {hint.length > 0 && (
        <p className="mt-2 text-[14px] leading-7 text-ink-soft" aria-live="polite">
          ระบบจะค้นด้วยคำในกฎหมายเพิ่ม:{" "}
          {hint.map((w, i) => (
            <span key={w}>
              {i > 0 && " · "}
              <span className="text-ink underline decoration-form decoration-dashed decoration-2 underline-offset-[5px]">{w}</span>
            </span>
          ))}
        </p>
      )}
      {first && embedExamples && (
        <fieldset className="mt-5">
          <legend className="text-[14px] text-form-soft">หรือเลือกคำถามตัวอย่าง</legend>
          <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
            {EXAMPLES.map((e) => (
              <li key={e}>
                <button
                  type="button"
                  onClick={() => ask(e)}
                  className="group flex min-h-11 w-full items-center justify-between gap-3 border-b border-rule py-2 text-left text-[15px] leading-6 text-ink hover:border-form hover:text-form focus-visible:border-form"
                >
                  {e}
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-form opacity-30 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </form>
  );
}

/* ---------- section 3: one quoted clause ---------- */

/* ---------- guide marks: which words and which sentence answer the question ---------- */

const STOP = new Set("นี้ นั้น ตอนนี้ ตอนนั้น ไหม ที่ ได้ ไม่ อะไร อย่างไร ยังไง ต้อง มี เป็น การ ของ และ หรือ กับ ใน จะ ให้ ก็ คือ บ้าง เท่าไร เท่าไหร่ ไหน ครับ ค่ะ คะ นะ แล้ว ถ้า ว่า ซึ่ง โดย จาก แต่ ทำ เอง ครั้ง เดียว หมด ไป มา อยู่ ต่อ ยัง ทุก กี่ ใคร เมื่อ ตอน ช่วย บอก อยาก รู้".split(" "));
// Thai letters only: vowel and tone marks above/below do not count, so "นี้" is 1 letter, not 3
const letters = (w) => w.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
function askedWords(q) {
  try {
    const seg = new Intl.Segmenter("th", { granularity: "word" });
    return [...new Set([...seg.segment(q)].filter((x) => x.isWordLike && letters(x.segment) >= 3 && !STOP.has(x.segment)).map((x) => x.segment))];
  } catch {
    return [];
  }
}

function Guided({ text, guide, words = [], legal = [], hot = [] }) {
  // per character: 1 = the member's word, 2 = a legal term the search added (longest wins)
  const kind = new Uint8Array(text.length);
  const mark = (list, k) => {
    for (const w of [...list].sort((a, b) => a.length - b.length)) {
      if (!w) continue;
      for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + w.length)) kind.fill(k, at, at + w.length);
    }
  };
  mark(words, 1);
  mark(legal, 2);
  mark(hot, 3); // the member's words that also sit in a yellow answer span: yellow here too
  const g0 = guide ? guide.start : -1, g1 = guide ? guide.end : -1;
  const runs = [];
  for (let i = 0; i < text.length; ) {
    const k = kind[i], inG = i >= g0 && i < g1;
    let j = i + 1;
    while (j < text.length && kind[j] === k && (j >= g0 && j < g1) === inG) j++;
    runs.push({ t: text.slice(i, j), k, g: inG });
    i = j;
  }
  return runs.map((r, i) => {
    const cls = [
      r.g || r.k === 3 ? "bg-guide text-ink" : "",
      r.k === 1 || r.k === 3 ? "underline decoration-asked decoration-2 underline-offset-[5px]" : "",
      r.k === 2 ? "underline decoration-form decoration-dashed decoration-2 underline-offset-[5px]" : "",
    ].join(" ").trim();
    return cls ? <span key={i} className={cls} data-guide={r.g ? "" : undefined}>{r.t}</span> : r.t;
  });
}

function GuideKey({ any }) {
  if (!any) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-6 text-ink-soft">
      <span className="inline-flex items-center gap-1.5"><span className="bg-guide px-1 whitespace-nowrap text-ink">แถบเหลือง</span> ส่วนที่ตอบคำถามตรงที่สุด และคำในคำถามที่อยู่ในส่วนนั้น</span>
      <span className="inline-flex items-center gap-1.5"><span className="text-ink underline decoration-asked decoration-2 underline-offset-[5px] whitespace-nowrap">ขีดน้ำเงิน</span> คำจากคำถามของคุณ</span>
      <span className="inline-flex items-center gap-1.5"><span className="text-ink underline decoration-form decoration-dashed decoration-2 underline-offset-[5px] whitespace-nowrap">ขีดเขียวประ</span> คำกฎหมายที่ระบบเพิ่ม</span>
    </p>
  );
}

function Citation({ n, h, reading, open, staff, marks }) {
  const gone = isCancelled(h);
  const active = reading === h.id;
  const first = Number(String(pageLabel(h)).split("-")[0]) || 1;
  // the original PDF page is the default view (members trust the printed page); the choice is remembered
  const [pdf, setPdfState] = useState(() => Boolean(h.key) && (localStorage.getItem("cardView") || "pdf") === "pdf");
  const setPdf = (on) => {
    setPdfState(on);
    localStorage.setItem("cardView", on ? "pdf" : "text");
  };
  const [pg, setPg] = useState(first);
  const [total, setTotal] = useState(null);
  const [pages, setPages] = useState(null); // OCR text of every page, for "อ่านทั้งหน้า"
  const [full, setFull] = useState(false);
  const [pdfOk, setPdfOk] = useState(true);
  useEffect(() => {
    if (pdf) loadDoc();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function loadDoc() {
    if (total == null && h.key)
      fetch(`/api/doc?key=${encodeURIComponent(h.key)}`)
        .then((r) => r.json())
        .then((d) => {
          setTotal(d.pages?.length || null);
          setPages(d.pages || []);
          setPdfOk(d.pdf_local !== false);
        })
        .catch(() => {});
  }
  const showPdf = (p = pg) => {
    setPg(p);
    setPdf(true);
    loadDoc();
  };
  return (
    <article className={`border bg-sheet ${active ? "border-mark" : "border-form"}`}>
      <div className="flex items-stretch border-b border-rule">
        <div
          className={`flex w-10 shrink-0 items-center justify-center border-r border-rule text-[17px] font-semibold tnum ${active ? "bg-mark text-sheet" : "text-form"}`}
        >
          {thai(n)}
        </div>
        <Field label="ชื่อเอกสาร" className="flex-1">
          <span className="font-medium">{h.title}</span>
        </Field>
      </div>
      <div className="grid grid-cols-2 border-b border-rule sm:grid-cols-[1.3fr_0.7fr_1fr_1.4fr]">
        <Field label="ข้อ / มาตรา" className="border-r">
          {h.section || "—"}
        </Field>
        <Field label="หน้า" className="sm:border-r">
          {h.key ? (
            <button
              type="button"
              onClick={() => showPdf(first)}
              title="ดู PDF ต้นฉบับหน้านี้ในการ์ด"
              className="inline-flex items-center gap-1.5 text-form underline decoration-rule underline-offset-4 hover:text-ink"
            >
              {pageLabel(h)} <span className="text-[13px] font-medium">ดู PDF</span>
            </button>
          ) : (
            pageLabel(h)
          )}
        </Field>
        <Field label="มีผล" className="border-r border-t sm:border-t-0">
          {thDate(h.effect) || "—"}
        </Field>
        <Field label="สถานะ" className="border-t sm:border-t-0">
          <span className="flex flex-wrap gap-x-3">
            <span className="inline-flex items-center gap-1.5">
              <Box checked={!gone} /> ใช้บังคับ
            </span>
            <span className={`inline-flex items-center gap-1.5 ${gone ? "text-stamp" : "text-ink-soft"}`}>
              <Box checked={gone} tone={gone ? "stamp" : "form"} /> ยกเลิกแล้ว
            </span>
          </span>
        </Field>
      </div>
      {h.key && (
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-1.5 sm:px-5" role="group" aria-label="รูปแบบการแสดง">
          {[
            [false, "ข้อความที่อ้าง (OCR)", BookOpenText],
            [true, "PDF ต้นฉบับ", FileText],
          ].map(([k, label, Icon]) => (
            <button
              key={label}
              type="button"
              aria-pressed={pdf === k}
              onClick={() => (k ? showPdf() : setPdf(false))}
              className={`inline-flex min-h-9 items-center gap-1.5 border px-2.5 text-[14px] ${
                pdf === k ? "border-form bg-form font-semibold text-sheet" : "border-rule bg-sheet text-ink hover:border-form"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
          {(pdf || full) && (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPg((p) => Math.max(1, p - 1))}
                disabled={pg <= 1}
                className="inline-flex h-9 w-9 items-center justify-center text-form disabled:text-rule"
                aria-label="หน้าก่อน"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <label className="tnum inline-flex items-center gap-1.5 text-[14px]">
                หน้า
                <select
                  value={pg}
                  onChange={(e) => setPg(Number(e.target.value))}
                  className="min-h-9 border border-rule bg-sheet px-1.5 text-[14px] text-ink"
                >
                  {Array.from({ length: total || Math.max(pg, first) }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>
                      {p}{p === first ? " (ที่อ้าง)" : ""}
                    </option>
                  ))}
                </select>
                {total ? <span className="text-ink-soft">จาก {total}</span> : null}
              </label>
              <button
                type="button"
                onClick={() => setPg((p) => (total ? Math.min(total, p + 1) : p + 1))}
                disabled={total != null && pg >= total}
                className="inline-flex h-9 w-9 items-center justify-center text-form disabled:text-rule"
                aria-label="หน้าถัดไป"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      )}
      {pdf && h.key && !pdfOk ? (
        <p className="px-4 py-6 text-[15px] text-ink sm:px-5">
          ไฟล์ PDF นี้ใหญ่เกินกว่าจะแสดงในหน้านี้ได้ ·{" "}
          <a href={h.source_url} target="_blank" rel="noreferrer" className="font-medium text-form underline underline-offset-4">
            เปิดต้นฉบับบนเว็บกรมสรรพสามิต หน้า {pg}
          </a>
        </p>
      ) : pdf && h.key ? (
        <iframe
          key={pg}
          title={`PDF ${h.title} หน้า ${pg}`}
          src={`/api/pdf?key=${encodeURIComponent(h.key)}#page=${pg}&view=FitH&navpanes=0`}
          className="block h-[75vh] min-h-[28rem] w-full border-0 bg-tint"
        />
      ) : full && h.key ? (
        <div className="px-4 py-4 sm:px-5">
          <p className="mb-2 text-[13px] text-form-soft">ข้อความ OCR ทั้งหน้า {pg} · ส่วนที่อ้างมีพื้นสีส้ม · OCR อาจสะกดผิดบางคำ ตรวจตัวเลขกับ PDF</p>
          <div className="max-w-[82ch] font-law text-[17px] leading-[1.85] whitespace-pre-line text-ink">
            {pages == null ? (
              <span className="text-ink-soft">กำลังโหลด…</span>
            ) : (
              <Highlight text={pages.find((x) => x.n === pg)?.text || "หน้านี้ไม่มีข้อความ"} needle={h.text} />
            )}
          </div>
        </div>
      ) : (
        <blockquote className="write-in max-w-[82ch] px-4 py-4 font-law text-[17px] leading-[1.85] whitespace-pre-line text-ink sm:px-5">
          <Guided text={h.text} guide={h.guide} words={marks?.words} legal={marks?.legal} />
        </blockquote>
      )}
      {!pdf && h.key && (
        <div className="px-4 pb-3 sm:px-5">
          <button
            type="button"
            onClick={() => {
              if (!full) {
                setPg(first);
                loadDoc();
              }
              setFull(!full);
            }}
            className="inline-flex min-h-10 items-center gap-1.5 border border-form px-3 text-[14px] font-medium text-form hover:bg-tint"
          >
            <BookOpenText className="h-4 w-4" aria-hidden="true" />
            {full ? "ย่อเหลือเฉพาะส่วนที่อ้าง" : `อ่านทั้งหน้า ${first}`}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-rule bg-tint px-4 py-1.5 text-[14px] sm:px-5">
        <button
          type="button"
          onClick={() => open(h)}
          className="inline-flex min-h-10 items-center gap-1.5 font-medium text-form hover:text-ink"
        >
          <BookOpenText className="h-4 w-4" /> อ่านข้อความเต็มจากเอกสาร
        </button>
        {h.key && (
          <a
            href={`/api/pdf?key=${encodeURIComponent(h.key)}#page=${pdf ? pg : first}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 text-form underline decoration-rule underline-offset-4 hover:text-ink"
          >
            <FileText className="h-4 w-4" /> เปิด PDF หน้า {pdf ? pg : first} ในแท็บใหม่ <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
        {h.source_url && (
          <a
            href={h.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 text-form underline decoration-rule underline-offset-4 hover:text-ink"
          >
            ต้นฉบับบนเว็บกรมสรรพสามิต <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
        {staff && (
          <span className="tnum ml-auto text-[13px] text-ink-soft">
            {h.rerank != null && `rerank ${h.rerank.toFixed(3)} · `}cos {h.cosine ?? "–"} · ตรงคำถาม {Math.round((h.match_q ?? 0) * 100)}% · {h.via}
          </span>
        )}
      </div>
    </article>
  );
}

/* ---------- staff-only box: base vs rerank ---------- */

function Column({ r, label, hover, setHover }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 border-b border-rule pb-1">
        <span className="font-medium text-ink">{label}</span>
        <span className="tnum text-ink-soft">{r.ms} ms</span>
      </div>
      <div className={`py-1 font-medium ${r.answered ? "text-form" : "text-stamp"}`}>
        {r.answered ? `ตอบ · อ้าง ${r.sources.length} รายการ` : "ไม่ตอบ"}
      </div>
      <ol>
        {r.considered.map((h) => (
          <li
            key={h.id}
            onMouseEnter={() => setHover(h.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(h.id)}
            tabIndex={0}
            className={`grid grid-cols-[16px_1fr_auto] gap-2 border-b border-rule/60 py-1.5 ${hover === h.id ? "bg-mark-wash" : ""}`}
          >
            <span className={`pt-0.5 ${h.pass ? "text-form" : "text-ink-soft"}`}>
              {h.pass ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <X className="h-3.5 w-3.5" />}
            </span>
            <span className={`min-w-0 ${h.pass ? "text-ink" : "text-ink-soft"}`}>
              <span className="line-clamp-1">{h.title}</span>
              <span className="text-ink-soft">
                {h.section ? `${h.section} · ` : ""}น.{pageLabel(h)}
              </span>
            </span>
            <span className="tnum text-right text-ink-soft">
              {r.mode === "rerank" ? (h.rerank ?? 0).toFixed(2) : `${h.cosine ?? "–"} / ${Math.round((h.match_q ?? 0) * 100)}%`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StaffBox({ r }) {
  const [hover, setHover] = useState(null);
  if (!r.base) return null;
  return (
    <section className="mt-5 border border-dashed border-form-soft bg-sheet p-4 text-[13.5px] leading-5">
      <Label className="mb-3">สำหรับเจ้าหน้าที่ · เทียบวิธีค้น (ชี้ที่รายการเพื่อจับคู่สองฝั่ง)</Label>
      <div className="grid gap-5 md:grid-cols-2">
        <Column r={r.base} label="base: cos + คำตรง" hover={hover} setHover={setHover} />
        <Column r={r} label="rerank ≥ 0.5 (ที่ใช้ตอบ)" hover={hover} setHover={setHover} />
      </div>
    </section>
  );
}

/* ---------- one filled answer sheet ---------- */

function Refusal({ r, ask }) {
  return (
    <div className="px-5 py-5 sm:px-8">
      <div className="stamp-in inline-flex items-center gap-2 border-2 border-stamp px-3 py-1.5 text-[16px] font-semibold text-stamp">
        <SearchX className="h-5 w-5" /> ไม่พบในเอกสารในคลัง
      </div>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink">
        ไม่มีข้อความในเอกสารที่ตรงกับคำถามมากพอ บอตจึงไม่ตอบ เพื่อไม่ให้เดา
      </p>
      <Label className="mt-4">ลองต่อได้ดังนี้</Label>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink marker:text-form-soft">
        <li>ใช้คำในกฎหมาย เช่น “ใบอนุญาตผลิตสุรา” แทน “เปิดโรงเบียร์”</li>
        <li>ระบุเรื่องให้แคบลง เช่น ภาษี ฉลาก แสตมป์ หรือค่าธรรมเนียม</li>
        <li>ถ้าไม่ใช่เรื่องสรรพสามิต (เช่น วิธีต้มเบียร์) ถามผู้รู้หรือกรมสรรพสามิตโดยตรง</li>
      </ul>
      {r.expanded?.length > 0 && (
        <button
          type="button"
          onClick={() => ask(r.expanded.join(" "))}
          className="mt-3 inline-flex min-h-11 items-center gap-2 border border-form px-3 text-[14px] font-medium text-form hover:bg-tint"
        >
          ค้นใหม่ด้วยคำในกฎหมายอย่างเดียว: {r.expanded.join(" ")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

function Turn({ n, t, reading, open, staff, ask, embed }) {
  const r = t.r;
  const marks = useMemo(() => ({ words: askedWords(t.q), legal: r?.expanded || [] }), [t.q, r]);
  const found = useMemo(() => {
    const all = (r?.sources || []).map((h) => h.text).join("\n");
    return marks.words.filter((w) => all.includes(w));
  }, [r, marks]);
  const hot = useMemo(() => {
    const spans = (r?.sources || []).filter((h) => h.guide).map((h) => h.text.slice(h.guide.start, h.guide.end)).join("\n");
    return found.filter((w) => spans.includes(w));
  }, [r, found]);
  return (
    <section className={embed ? "" : "border-t-2 border-form"} aria-label={`ใบตอบที่ ${n}`}>
      {embed && (
        <div className="flex justify-end px-4 pt-4">
          <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-form px-4 py-2 text-[16px] leading-7 text-sheet">
            {hot.length ? <Guided text={t.q} hot={hot} /> : t.q}
          </p>
        </div>
      )}
      <div className={embed ? "hidden" : "flex items-baseline justify-between gap-3 bg-tint px-5 py-2 sm:px-8"}>
        <span className="flex items-baseline gap-4">
          <span className="text-[14px] font-medium text-form">ใบตอบที่ {thai(n)}</span>
          {r && !r.error && <span className="tnum text-[13px] text-form-soft">ค้นเสร็จใน {(r.ms / 1000).toFixed(1)} วินาที</span>}
        </span>
        {n === 1 && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("go-home"))}
            className="inline-flex min-h-9 items-center gap-1 text-[14px] font-medium text-form underline decoration-rule underline-offset-4 hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> หน้าแรก · เลือกเรื่องอื่น
          </button>
        )}
      </div>
      <div className={embed ? "hidden" : "px-5 pt-4 sm:px-8"}>
        <Label n={1}>คำถาม</Label>
        <p className="dotline mt-1 pb-1.5 text-[18px] leading-8 text-ink">{found.length ? <Guided text={t.q} words={found} hot={hot} /> : t.q}</p>
      </div>
      {!r && (
        <div className="px-5 py-5 sm:px-8" aria-live="polite">
          <div className="flex items-center gap-2 text-[14px] text-form">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังค้นในเอกสาร {t.slow ? "· เซิร์ฟเวอร์อาจกำลังเริ่มเครื่อง รอสักครู่" : ""}
          </div>
          <div className="mt-4 space-y-3">
            {[92, 78, 85].map((w, i) => (
              <div key={i} className="pending h-3 bg-tint" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      )}
      {r?.error && (
        <div className="px-5 py-5 text-[15px] text-stamp sm:px-8">ส่งคำถามไม่สำเร็จ ({r.error}) ลองส่งใหม่อีกครั้ง</div>
      )}
      {r && !r.error && (
        <>
          {r.expanded?.length > 0 && (
            <div className="px-5 pt-4 sm:px-8">
              <Label n={embed ? 1 : 2}>คำในกฎหมายที่ใช้ค้นเพิ่ม</Label>
              <p className="write-in mt-1 text-[15px] leading-7 text-ink">
                {r.expanded.map((w, i) => (
                  <span key={w}>
                    {i > 0 && " · "}
                    <span className="underline decoration-form decoration-dashed decoration-2 underline-offset-[5px]">{w}</span>
                  </span>
                ))}
              </p>
            </div>
          )}
          {r.answered ? (
            <div className="px-5 py-4 sm:px-8">
              <Label n={(r.expanded?.length ? 3 : 2) - (embed ? 1 : 0)}>ข้อความจากเอกสาร ({thai(r.sources.length)} รายการ เรียงฉบับที่ใช้บังคับล่าสุดก่อน)</Label>
              <GuideKey any={r.sources.some((h) => h.guide) || found.length > 0 || r.expanded?.length > 0} />
              <div className="mt-3 space-y-4">
                {r.sources.map((h, i) => (
                  <Citation key={h.id} n={i + 1} h={h} reading={reading} open={open} staff={staff} marks={marks} />
                ))}
              </div>
              {staff && <StaffBox r={r} />}
            </div>
          ) : (
            <>
              <Refusal r={r} ask={ask} />
              {staff && (
                <div className="px-5 pb-5 sm:px-8">
                  <StaffBox r={r} />
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- the reader: เอกสารแนบ ---------- */

function Highlight({ text, needle }) {
  const at = needle ? text.indexOf(needle.slice(0, 60)) : -1;
  if (at < 0) return text;
  let end = at + needle.length;
  const tail = needle.slice(-40);
  const t2 = text.indexOf(tail, at);
  if (t2 >= 0) end = t2 + tail.length;
  return (
    <>
      {text.slice(0, at)}
      <mark data-cited className="bg-mark-wash text-ink underline decoration-mark decoration-2 underline-offset-[5px]">
        {text.slice(at, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

function useWide() {
  const q = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function Reader({ hit, close, wide }) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const start = Number(String(pageLabel(hit)).split("-")[0]) || 1;
  const [page, setPage] = useState(start);
  // what to read: the OCR text the search works on, or the original PDF (same page rail drives both)
  const [view, setView] = useState(() => localStorage.getItem("readerView") || "text");
  useEffect(() => localStorage.setItem("readerView", view), [view]);
  const body = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => closeRef.current?.focus(), [hit.id]);

  useEffect(() => {
    let live = true;
    setDoc(null);
    setErr(null);
    setPage(start);
    fetch(`/api/doc?key=${encodeURIComponent(hit.key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => live && setDoc(d))
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [hit.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") close();
      if (!doc) return;
      if (e.key === "ArrowRight") setPage((p) => Math.min(doc.pages.length, p + 1));
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, close]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const m = el.querySelector("[data-cited]");
    if (m) m.scrollIntoView({ block: "center" });
    else el.scrollTop = 0;
  }, [doc, page]);

  const cur = doc?.pages.find((p) => p.n === page);
  const secsHere = doc?.sections.filter((s) => s.section && s.page === page) ?? [];
  const gone = isCancelled(hit);

  return (
    <aside
      role="dialog"
      aria-modal={!wide}
      aria-labelledby="reader-title"
      className="sheet-in fixed inset-0 z-30 flex flex-col bg-sheet shadow-[0_8px_40px_rgb(20_40_30/0.22)] lg:inset-y-3 lg:right-3 lg:left-auto lg:w-[min(46rem,48vw)] lg:border lg:border-form"
    >
      <div className="flex items-start gap-3 border-b-2 border-form px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id="reader-title" className="text-[17px] leading-7 font-semibold text-form">{hit.title}</h2>
          <div className="tnum mt-1 flex flex-wrap gap-x-4 text-[14px] text-ink-soft">
            {hit.section && <span>อ้างถึง {hit.section}</span>}
            {hit.effect && <span>มีผล {thDate(hit.effect)}</span>}
            {gone && <span className="font-medium text-stamp">ยกเลิกแล้ว</span>}
          </div>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center border border-rule text-form hover:border-form"
          aria-label="ปิดเอกสาร"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-3 border-b border-rule px-5 py-2" role="group" aria-label="รูปแบบการอ่าน">
        {[
          ["text", "ข้อความ (OCR)", "ที่ระบบใช้ค้น ไฮไลต์ส่วนที่อ้าง"],
          ["pdf", "PDF ต้นฉบับ", "ภาพหน้าจริงจากราชกิจจาฯ"],
        ].map(([k, label, note]) => (
          <button
            key={k}
            type="button"
            aria-pressed={view === k}
            onClick={() => setView(k)}
            disabled={k === "pdf" && doc && !doc.pdf_local}
            title={note}
            className={`inline-flex min-h-10 items-center gap-1.5 border px-3 text-[14px] ${
              view === k ? "border-form bg-form font-semibold text-sheet" : "border-rule bg-sheet text-ink hover:border-form disabled:text-ink-soft/60"
            }`}
          >
            {k === "text" ? <BookOpenText className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            {label}
          </button>
        ))}
        <span className="hidden text-[13px] text-ink-soft sm:inline">{view === "text" ? "ค้นจากข้อความนี้ · อาจสะกดผิดบางคำ" : "ตรวจตัวเลขและเครื่องหมายกับหน้านี้"}</span>
        {doc?.pdf_local && (
          <a
            href={`/api/pdf?key=${encodeURIComponent(doc.key)}#page=${page}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex min-h-10 shrink-0 items-center gap-1.5 text-[14px] font-medium text-form underline decoration-rule underline-offset-4 hover:text-ink"
          >
            เปิด PDF ในแท็บใหม่ <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {doc && (
        <div className="flex items-center gap-2 border-b border-rule bg-tint px-3 py-1.5">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex h-11 w-11 items-center justify-center text-form disabled:text-rule lg:h-9 lg:w-9"
            aria-label="หน้าก่อน"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5" aria-label="หน้า">
            {doc.pages.map((p) => {
              const cited = String(pageLabel(hit)).includes("-")
                ? p.n >= start && p.n <= Number(String(pageLabel(hit)).split("-")[1])
                : p.n === start;
              return (
                <button
                  key={p.n}
                  type="button"
                  onClick={() => setPage(p.n)}
                  aria-current={p.n === page ? "page" : undefined}
                  ref={p.n === page ? (el) => el?.scrollIntoView({ block: "nearest", inline: "center" }) : undefined}
                  className={`tnum h-11 min-w-11 shrink-0 border lg:h-8 lg:min-w-8 px-1.5 text-[14px] ${
                    p.n === page
                      ? "border-form bg-form text-sheet"
                      : cited
                        ? "border-mark text-mark"
                        : "border-rule bg-sheet text-ink-soft hover:border-form"
                  }`}
                >
                  {p.n}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(doc.pages.length, p + 1))}
            disabled={page >= doc.pages.length}
            className="inline-flex h-11 w-11 items-center justify-center text-form disabled:text-rule lg:h-9 lg:w-9"
            aria-label="หน้าถัดไป"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      <div ref={body} className="min-h-0 flex-1 overflow-y-auto">
        {err && <p className="p-5 text-stamp">เปิดเอกสารไม่ได้ ({err})</p>}
        {!doc && !err && (
          <div className="space-y-3 p-5">
            {[88, 96, 70, 92, 80].map((w, i) => (
              <div key={i} className="pending h-3 bg-tint" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {doc && view === "pdf" && doc.pdf_local && (
          <iframe
            key={page}
            title={`PDF ${hit.title} หน้า ${page}`}
            src={`/api/pdf?key=${encodeURIComponent(doc.key)}#page=${page}&view=FitH&navpanes=0`}
            className="h-full w-full border-0 bg-tint"
          />
        )}
        {doc && view === "text" && (
          <>
            {secsHere.length > 0 && (
              <div className="tnum flex flex-wrap gap-x-3 gap-y-1 border-b border-rule px-5 py-2 text-[13.5px] text-form-soft">
                ในหน้านี้: {secsHere.map((s) => s.section).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12).join(" · ")}
              </div>
            )}
            <div className="mx-auto max-w-[68ch] px-5 py-5 font-law text-[17px] leading-[1.9] whitespace-pre-line text-ink">
              {cur ? <Highlight text={cur.text} needle={hit.text} /> : <span className="text-ink-soft">หน้านี้ไม่มีข้อความ</span>}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-tint px-5 py-2 text-[14px]">
        <span className="tnum text-ink-soft">
          {doc ? `หน้า ${page} จาก ${doc.pages.length} · ${view === "pdf" ? "PDF ต้นฉบับ (สำเนาในเครื่อง)" : "ข้อความจาก OCR อาจสะกดผิดบางคำ"}` : ""}
        </span>
        {hit.source_url && (
          <a
            href={hit.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 font-medium text-form hover:text-ink"
          >
            <FileText className="h-4 w-4" /> ตรวจกับ PDF ต้นฉบับ <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </aside>
  );
}

/* ---------- the page ---------- */

function useHash() {
  const [h, setH] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setH(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}

export default function App() {
  const h = useHash();
  if (h.startsWith("#/embed")) return <Chat embed />;
  // the full-page form is the main page (#/, old #/ask kept as an alias); no pop-up beside it
  if (h === "#/map" || h === "#/site")
    return (
      <>
        {h === "#/map" ? <Explorer /> : <Home />}
        <ChatWidget />
      </>
    );
  return <Chat />;
}

/* ---------- answers live in the URL ---------- */
function urlQs() {
  const h = window.location.hash;
  if (!h.startsWith("#/answer")) return [];
  return new URLSearchParams(h.split("?")[1] || "").getAll("q").filter(Boolean);
}
function answerHash(qs) {
  return "#/answer?" + qs.map((q) => "q=" + encodeURIComponent(q)).join("&");
}
function cachedAnswer(q) {
  try {
    return JSON.parse(sessionStorage.getItem("answers") || "{}")[q] || null;
  } catch {
    return null;
  }
}
async function fetchAnswer(q, embed) {
  let r;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, compare: true, src: embed ? "popup" : "web" }),
    });
    r = res.ok ? await res.json() : { error: `server ${res.status}` };
  } catch (e) {
    r = { error: String(e) };
  }
  if (!r.error) {
    try {
      const all = JSON.parse(sessionStorage.getItem("answers") || "{}");
      all[q] = r;
      const keys = Object.keys(all);
      if (keys.length > 30) delete all[keys[0]]; // keep the newest 30
      sessionStorage.setItem("answers", JSON.stringify(all));
    } catch {
      /* storage full or blocked: memory only */
    }
  }
  return r;
}

function Chat({ embed = false }) {
  const [q, setQ] = useState("");
  // the conversation survives closing the pop-up, reloads and switching to the full page (same tab)
  // The URL is the source of truth for what is on screen: #/answer?q=…&q=… (one q per question, in order).
  // Every question pushes a URL, so Back/Forward step through the questions, a reload keeps them and a link
  // opens the same answers. Answers are cached per question in sessionStorage; only missing ones are asked.
  const [turns, setTurns] = useState(() => (embed ? [] : urlQs().map((q) => ({ q, r: cachedAnswer(q) }))));
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  useEffect(() => {
    if (embed) return undefined;
    const sync = () => {
      const qs = urlQs();
      setReading(null);
      if (!qs.length) {
        setTurns([]);
        window.scrollTo({ top: 0 });
        return;
      }
      const old = turnsRef.current;
      const next = qs.map((q, i) => (old[i] && old[i].q === q && old[i].r ? old[i] : { q, r: cachedAnswer(q) }));
      setTurns(next);
      next.forEach((t, i) => {
        if (!t.r) fetchAnswer(t.q, embed).then((r) => setTurns((cur) => cur.map((x, j) => (j === i && x.q === t.q ? { ...x, r } : x))));
      });
    };
    sync(); // a reload or a shared link: ask whatever is not cached yet
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    // the nav tab, the brand and the button on an answer: go to the first page (a new URL, so Back returns)
    const home = () => {
      if (urlQs().length) window.history.pushState(null, "", "#/");
      sync();
    };
    window.addEventListener("go-home", home);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("go-home", home);
    };
  }, [embed]);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [staff, setStaff] = useState(() => localStorage.getItem("staff") === "1");
  const [reading, setReading] = useState(null);
  const end = useRef(null);

  useEffect(() => localStorage.setItem("staff", staff ? "1" : "0"), [staff]);

  useEffect(() => {
    let timer;
    const check = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => {
          setHealth({ error: true });
          timer = setTimeout(check, 4000);
        });
    check();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [turns.length]);

  const ask = useCallback(
    async (text) => {
      const question = (text ?? q).trim();
      if (!question || busy) return;
      setQ("");
      setBusy(true);
      const idx = turns.length;
      if (!embed) window.history.pushState(null, "", answerHash([...turns.map((t) => t.q), question]));
      setTurns((t) => [...t, { q: question, r: null }]);
      const slow = setTimeout(() => setTurns((t) => t.map((x, i) => (i === idx ? { ...x, slow: true } : x))), 4000);
      const r = cachedAnswer(question) || (await fetchAnswer(question, embed));
      clearTimeout(slow);
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, r } : x)));
      setBusy(false);
    },
    [q, busy, turns.length],
  );

  const wide = useWide();
  const opener = useRef(null);
  const openReader = useCallback((h) => {
    opener.current = document.activeElement;
    setReading(h);
  }, []);
  const close = useCallback(() => {
    setReading(null);
    requestAnimationFrame(() => opener.current?.focus?.());
  }, []);

  return (
    <div className={embed ? "min-h-screen bg-sheet" : `min-h-screen px-0 sm:px-6 sm:pb-6 ${reading ? "lg:pr-[min(48rem,50vw)]" : ""}`}>
      {!embed && <Nav here="ask" wide inert={reading && !wide ? "" : undefined} />}
      <main inert={reading && !wide ? "" : undefined} className={embed ? "bg-sheet" : "mx-auto max-w-[90rem] border-form bg-sheet shadow-[0_2px_14px_rgb(20_40_30/0.10)] sm:border"}>
        {embed ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-rule bg-tint px-5 py-1.5 text-[13px] text-ink-soft">
            <span>ตอบจากเอกสารในคลังเท่านั้น</span>
            <span className="font-semibold text-form">ต้นแบบ · ยังไม่ใช่คำแนะนำทางกฎหมาย</span>
          </div>
        ) : (
          <Header health={health} staff={staff} setStaff={setStaff} />
        )}
        {turns.length === 0 && <Ask q={q} setQ={setQ} ask={ask} busy={busy} first embedExamples={embed} />}
        {turns.length === 0 && !embed && <Front ask={ask} />}
        {turns.length === 0 && staff && !embed && (
          <div className="border-t border-rule px-5 py-5 sm:px-8">
            <Popular ask={ask} />
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} ref={i === turns.length - 1 ? end : null}>
            <Turn n={i + 1} t={t} reading={reading?.id} open={openReader} staff={staff} ask={ask} embed={embed} />
          </div>
        ))}
        {turns.length > 0 && (
          <FloatingAsk q={q} setQ={setQ} ask={ask} busy={busy} />
        )}
        <footer className="border-t border-rule px-5 py-3 text-[13px] leading-5 text-form-soft sm:px-8">
          ข้อความทั้งหมดมาจากเอกสารสรรพสามิตที่รวบรวมไว้ในคลังนี้ บอตไม่แต่งคำตอบเอง ·
          ต้นแบบนี้ยังไม่ใช่คำแนะนำทางกฎหมาย ตรวจกับ PDF ต้นฉบับทุกครั้งก่อนใช้
        </footer>
      </main>
      {reading && <Reader hit={reading} close={close} wide={wide} />}
    </div>
  );
}
