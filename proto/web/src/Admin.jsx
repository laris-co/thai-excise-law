/* Reviewer back office (#/admin): sign in with Google, check each OCR page against the PDF, fix or approve it.
   Every save is a revision (who, when, note); proto/ocr_revisions.py pulls the reviewed pages into the index.
   Queue order comes from proto/ocr_quality.py (/data/ocr_quality.json): the worst-scored pages first. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, History, Loader2, LogOut, Save, UserPlus, Users, X } from "lucide-react";
import * as fb from "./firebase.js";

const GRADE = {
  fix: { label: "ต้องแก้", cls: "bg-stamp text-sheet" },
  check: { label: "ควรตรวจ", cls: "bg-mark-wash text-ink" },
  ok: { label: "ดี", cls: "bg-tint text-form" },
};
const FLAG = {
  num_lost: "เลขข้อ/มาตราหาย",
  heading: "หัวข้ออ่านผิด",
  marks: "สระ/วรรณยุกต์ลอย",
  odd: "ตัวอักษรแปลก",
  unknown: "คำที่ไม่มีในพจนานุกรม",
  numbers: "ตัวเลขไม่ตรงกับ PDF",
  short: "ข้อความน้อยผิดปกติ",
  empty: "หน้าว่าง",
};
// the queue is for craft brewers: beer documents in force by default (beer / liquor / in_force from ocr_quality.py)
const SCOPE = {
  beer: { label: "คราฟต์เบียร์ (ใช้อยู่)", test: (d) => d.beer && d.in_force },
  liquor: { label: "สุราทั้งหมด (ใช้อยู่)", test: (d) => d.liquor && d.in_force },
  all: { label: "ทุกฉบับ รวมที่ยกเลิกแล้ว", test: () => true },
};
const STATUS = { approved: "ตรวจแล้ว ถูกต้อง", fixed: "แก้ไขแล้ว" };

function useHash() {
  const [h, setH] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setH(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}
const params = (h) => new URLSearchParams(h.split("?")[1] || "");
const pageHref = (key, n) => `#/admin/page?key=${encodeURIComponent(key)}&page=${n}`;
const when = (t) => (t?.toDate ? t.toDate().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "");

let qualityCache = null;
async function loadQuality() {
  if (!qualityCache)
    qualityCache = fetch("/data/ocr_quality.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  return qualityCache;
}

/* ---------- shell: sign-in and role ---------- */
export default function Admin() {
  const h = useHash();
  const [user, setUser] = useState(undefined);
  const [role, setRole] = useState(undefined);
  const [err, setErr] = useState("");
  useEffect(
    () =>
      fb.watchUser(async (u) => {
        setUser(u);
        setRole(undefined);
        if (u) setRole(await fb.myRole(u.email.toLowerCase()).catch(() => null));
      }),
    [],
  );
  const signIn = () => fb.signIn().catch((e) => setErr(e.code === "auth/popup-closed-by-user" ? "" : String(e.message || e)));

  let body;
  if (user === undefined || (user && role === undefined))
    body = (
      <p className="flex items-center gap-2 p-8 text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด
      </p>
    );
  else if (!user)
    body = (
      <div className="mx-auto max-w-[34rem] p-8">
        <h1 className="text-[22px] font-semibold text-ink">ระบบตรวจทานเอกสาร</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          สำหรับผู้ตรวจที่ได้รับเชิญ: เทียบข้อความจาก OCR กับ PDF ต้นฉบับทีละหน้า แก้คำที่อ่านผิด แล้วบันทึก ทุกครั้งที่บันทึกจะเก็บประวัติว่าใครแก้อะไรเมื่อไร
        </p>
        <button
          type="button"
          onClick={signIn}
          className="mt-6 inline-flex min-h-11 items-center gap-2 border border-form bg-form px-5 text-[15px] font-medium text-sheet hover:bg-form-soft"
        >
          เข้าสู่ระบบด้วย Google
        </button>
        {err && <p className="mt-3 text-[14px] text-stamp">{err}</p>}
      </div>
    );
  else if (!role)
    body = (
      <div className="mx-auto max-w-[34rem] p-8">
        <h1 className="text-[20px] font-semibold text-ink">บัญชีนี้ยังไม่ได้รับสิทธิ์ตรวจ</h1>
        <p className="mt-3 text-[15px] text-ink-soft">
          ส่งอีเมล <span className="font-medium text-ink">{user.email}</span> ให้ผู้ดูแล เพื่อเพิ่มเป็นผู้ตรวจ
        </p>
        <button type="button" onClick={fb.signOutNow} className="mt-5 text-[14px] text-form underline underline-offset-4">
          ใช้บัญชีอื่น
        </button>
      </div>
    );
  else if (h.startsWith("#/admin/page")) body = <Editor me={user.email.toLowerCase()} />;
  else if (h.startsWith("#/admin/people") && role === "admin") body = <People me={user.email.toLowerCase()} />;
  else body = <Queue />;

  return (
    <div className="flex min-h-screen flex-col px-0 sm:px-6 sm:pb-6">
      <div className="bg-form sm:-mx-6 sm:mb-6">
        <nav aria-label="เมนูผู้ตรวจ" className="mx-auto flex min-h-12 max-w-[93rem] items-center gap-4 px-5 text-[14px] text-sheet sm:px-6">
          <a href="#/admin" className="font-semibold hover:underline">
            ตรวจทานเอกสาร
          </a>
          {role === "admin" && (
            <a href="#/admin/people" className="inline-flex items-center gap-1.5 text-[#d7e6dc] hover:text-sheet">
              <Users className="h-4 w-4" aria-hidden="true" /> ผู้ตรวจ
            </a>
          )}
          <a href="#/" className="text-[#d7e6dc] hover:text-sheet">
            หน้าถามข้อกฎหมาย
          </a>
          <span className="flex-1" />
          {user && (
            <>
              <span className="hidden text-[#d7e6dc] sm:inline">{user.email}</span>
              <button type="button" onClick={fb.signOutNow} className="inline-flex items-center gap-1 text-[#d7e6dc] hover:text-sheet">
                <LogOut className="h-4 w-4" aria-hidden="true" /> ออก
              </button>
            </>
          )}
        </nav>
      </div>
      <main className="mx-auto w-full max-w-[90rem] flex-1 border-form bg-sheet shadow-[0_2px_14px_rgb(20_40_30/0.10)] sm:border">{body}</main>
    </div>
  );
}

/* ---------- the queue: documents, worst first ---------- */
function Queue() {
  const [q, setQ] = useState(null);
  const [done, setDone] = useState(null);
  const [grade, setGrade] = useState("todo");
  const [scope, setScope] = useState("beer");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => {
    loadQuality().then(setQ);
    fb.progress()
      .then(setDone)
      .catch(() => setDone({}));
  }, []);
  const rows = useMemo(() => {
    if (!q || !done) return [];
    return Object.entries(q)
      .map(([key, d]) => {
        const st = done[key] || {};
        const reviewed = d.pages.filter((p) => st[p.page]).length;
        const fix = d.pages.filter((p) => p.grade === "fix" && !st[p.page]).length;
        const check = d.pages.filter((p) => p.grade === "check" && !st[p.page]).length;
        return { key, ...d, st, reviewed, fix, check };
      })
      .filter((r) => SCOPE[scope].test(r))
      .filter((r) => (grade === "todo" ? r.reviewed < r.pages.length : grade === "done" ? r.reviewed > 0 : true))
      .filter((r) => !find || (r.title || "").includes(find) || r.key.includes(find))
      .sort((a, b) => b.beer - a.beer || b.fix - a.fix || b.check - a.check || a.score - b.score);
  }, [q, done, grade, find, scope]);
  if (!q || !done)
    return (
      <p className="flex items-center gap-2 p-8 text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดคิว
      </p>
    );
  const inScope = Object.entries(q).filter(([, d]) => SCOPE[scope].test(d));
  const all = inScope.flatMap(([key, d]) => d.pages.map((p) => ({ ...p, key })));
  const reviewedAll = inScope.reduce((s, [key]) => s + Object.keys(done[key] || {}).length, 0);
  const n = (g) => all.filter((p) => p.grade === g).length;
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="text-[20px] font-semibold text-ink">คิวตรวจทาน</h1>
        <span className="tnum text-[14px] text-ink-soft">
          {inScope.length.toLocaleString()} ฉบับ · {all.length.toLocaleString()} หน้า · ตรวจแล้ว {reviewedAll.toLocaleString()} หน้า (
          {((100 * reviewedAll) / Math.max(all.length, 1)).toFixed(1)}%)
        </span>
      </div>
      <p className="mt-2 text-[14px] text-ink-soft">
        คะแนนอัตโนมัติจากร่องรอยที่ OCR มักผิด (เลขหาย สระลอย คำแปลก ตัวเลขไม่ตรงกับ PDF): ต้องแก้{" "}
        <b className="tnum text-stamp">{n("fix").toLocaleString()}</b> · ควรตรวจ <b className="tnum text-mark">{n("check").toLocaleString()}</b> · ดี{" "}
        <b className="tnum text-form">{n("ok").toLocaleString()}</b> หน้า คะแนนดีไม่ได้แปลว่าถูก ยังต้องมีคนอ่านเทียบ
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(SCOPE).map(([k, v]) => (
          <button
            key={k}
            type="button"
            onClick={() => setScope(k)}
            aria-pressed={scope === k}
            className={`min-h-9 border-b-[3px] px-2 text-[15px] ${scope === k ? "border-form font-semibold text-form" : "border-transparent text-ink-soft hover:text-form"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {[
          ["todo", "ยังต้องตรวจ"],
          ["done", "มีหน้าที่ตรวจแล้ว"],
          ["all", "ทั้งหมด"],
        ].map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setGrade(k)}
            aria-pressed={grade === k}
            className={`min-h-9 border px-3 text-[14px] ${grade === k ? "border-form bg-form text-sheet" : "border-rule text-form hover:bg-tint"}`}
          >
            {l}
          </button>
        ))}
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="ค้นชื่อเอกสาร"
          className="min-h-9 min-w-[14rem] flex-1 border border-rule px-3 text-[14px]"
        />
      </div>
      <ul className="mt-4 divide-y divide-rule border-y border-rule">
        {rows.slice(0, 200).map((r) => (
          <li key={r.key} className="py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button type="button" onClick={() => setOpen(open === r.key ? null : r.key)} className="min-w-0 flex-1 text-left text-[15px] text-ink hover:text-form">
                {r.beer && <span className="mr-2 bg-tint px-1.5 py-0.5 text-[12px] text-form">เบียร์</span>}
                {!r.in_force && <span className="mr-2 border border-rule px-1.5 py-0.5 text-[12px] text-ink-soft">ยกเลิกแล้ว</span>}
                {r.title || r.key}
              </button>
              <span className="tnum text-[13px] text-ink-soft">
                {r.fix > 0 && <span className="mr-2 text-stamp">ต้องแก้ {r.fix}</span>}
                {r.check > 0 && <span className="mr-2 text-mark">ควรตรวจ {r.check}</span>}
                ตรวจแล้ว {r.reviewed}/{r.pages.length}
              </span>
              <a href={pageHref(r.key, nextPage(r, r.st) || 1)} className="inline-flex min-h-9 items-center border border-form px-3 text-[14px] font-medium text-form hover:bg-tint">
                ตรวจ
              </a>
            </div>
            <div className="mt-2 h-1 bg-tint">
              <div className="h-1 bg-form" style={{ width: `${(100 * r.reviewed) / r.pages.length}%` }} />
            </div>
            {open === r.key && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.pages.map((p) => (
                  <a
                    key={p.page}
                    href={pageHref(r.key, p.page)}
                    title={`หน้า ${p.page} · คะแนน ${p.score}`}
                    className={`tnum inline-flex min-h-8 min-w-10 items-center justify-center px-2 text-[13px] ${
                      r.st[p.page] ? "border border-form bg-sheet text-form" : GRADE[p.grade].cls
                    }`}
                  >
                    {r.st[p.page] && <Check className="mr-0.5 h-3 w-3" aria-hidden="true" />}
                    {p.page}
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {rows.length > 200 && <p className="mt-3 text-[13px] text-ink-soft">แสดง 200 ฉบับแรกจาก {rows.length} · ค้นชื่อเพื่อหาฉบับอื่น</p>}
      {rows.length === 0 && <p className="mt-6 text-[15px] text-ink-soft">ไม่มีเอกสารในตัวกรองนี้</p>}
    </div>
  );
}

// the next page to review in a document: the lowest-scored one nobody has checked yet
function nextPage(d, st, after) {
  const left = d.pages.filter((p) => !st[p.page] && p.page !== after);
  left.sort((a, b) => a.score - b.score || a.page - b.page);
  return left[0]?.page;
}

/* ---------- line diff (LCS) between the machine text and the reviewed text ---------- */
function diffLines(a, b) {
  const A = a.split("\n"),
    B = b.split("\n");
  const m = A.length,
    n = B.length;
  const L = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0,
    j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) out.push([" ", A[i++]]), j++;
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", A[i++]]);
    else out.push(["+", B[j++]]);
  }
  while (i < m) out.push(["-", A[i++]]);
  while (j < n) out.push(["+", B[j++]]);
  return out;
}

/* ---------- one page: PDF on the left, editable text on the right ---------- */
function Editor({ me }) {
  const h = useHash();
  const p = params(h);
  const key = p.get("key") || "";
  const n = Number(p.get("page")) || 1;
  const [doc, setDoc] = useState(null);
  const [qual, setQual] = useState(null);
  const [rec, setRec] = useState(undefined);
  const [revs, setRevs] = useState([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState("edit");
  const [st, setSt] = useState({});
  const ta = useRef(null);

  useEffect(() => {
    setDoc(null);
    if (!/^\d+_\d+$/.test(key)) return;
    fetch(`/api/doc?key=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then(setDoc)
      .catch(() => setDoc({ error: true }));
    loadQuality().then((q) => setQual(q[key] || null));
  }, [key]);
  // the machine's text: kept from the first review, since the served page becomes the reviewed text after a pull
  const served = doc?.pages?.find((x) => x.n === n)?.text ?? "";
  const base = rec?.base ?? served;
  useEffect(() => {
    setRec(undefined);
    setMsg("");
    setNote("");
    setView("edit");
    if (!/^\d+_\d+$/.test(key)) return;
    fb.getPage(key, n).then((r) => setRec(r || null));
    fb.history(key, n).then(setRevs).catch(() => setRevs([]));
    fb.progress().then((d) => setSt(d[key] || {})).catch(() => {});
  }, [key, n]);
  useEffect(() => {
    if (doc && rec !== undefined) setText(rec ? rec.text : served);
  }, [doc, rec, served]);

  const current = rec ? rec.text : base;
  const dirty = text !== current;
  const pq = qual?.pages?.find((x) => x.page === n);
  const total = doc?.pages?.length || 0;

  const save = useCallback(
    async (status) => {
      setBusy(true);
      setMsg("");
      try {
        await fb.savePage({ key, n, text, base, status, note, by: me, rev: (rec?.rev || 0) + 1 });
        setMsg(status === "fixed" ? "บันทึกการแก้ไขแล้ว" : "บันทึกว่าหน้านี้ถูกต้องแล้ว");
        const d = (await fb.progress())[key] || {};
        setSt(d);
        setRec(await fb.getPage(key, n));
        setRevs(await fb.history(key, n));
        setNote("");
        const nx = qual ? nextPage(qual, d, n) : n < total ? n + 1 : null;
        if (nx) window.location.hash = pageHref(key, nx);
      } catch (e) {
        setMsg("บันทึกไม่สำเร็จ: " + (e.code || e.message || e));
      }
      setBusy(false);
    },
    [key, n, text, base, note, me, rec, qual, total],
  );
  useEffect(() => {
    const on = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && !busy) save("fixed");
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [dirty, busy, save]);

  // jump the cursor to a suspicious spot in the text
  const show = (s) => {
    const el = ta.current;
    if (!el) return;
    setView("edit");
    // the served text has Arabic digits (textnorm), the flags quote the OCR's Thai digits
    const probe = String(s)
      .replace(/[๐-๙]/g, (c) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(c)))
      .split(" ")
      .slice(0, 2)
      .join(" ");
    // "ขอ 1" must not stop at "ขอ 16": a number in the probe has to end where the probe ends
    const at = (p) => {
      const m = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (/[0-9]$/.test(p) ? "(?![0-9])" : "")).exec(el.value);
      return m ? m.index : -1;
    };
    let i = at(probe);
    if (i < 0) i = at(probe.split(" ")[0]);
    if (i < 0) return;
    el.focus();
    el.setSelectionRange(i, i + probe.length);
    const line = el.value.slice(0, i).split("\n").length;
    el.scrollTop = Math.max(0, (line - 4) * 28);
  };

  if (doc?.error) return <p className="p-8 text-stamp">ไม่พบเอกสาร {key}</p>;
  return (
    <div className="flex min-h-[85vh] flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-tint px-4 py-2 sm:px-6">
        <a href="#/admin" className="inline-flex min-h-10 items-center gap-1 border border-form bg-sheet px-3 text-[14px] font-medium text-form hover:bg-tint">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> คิว
        </a>
        <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">{doc?.title || key}</span>
        <span className="flex items-center gap-1">
          <a
            aria-label="หน้าก่อน"
            href={n > 1 ? pageHref(key, n - 1) : undefined}
            className={`inline-flex min-h-9 min-w-9 items-center justify-center border border-rule bg-sheet ${n > 1 ? "text-form hover:bg-tint" : "pointer-events-none opacity-40"}`}
          >
            <ChevronLeft className="h-4 w-4" />
          </a>
          <span className="tnum px-2 text-[14px] text-ink">
            หน้า {n}/{total || "…"}
          </span>
          <a
            aria-label="หน้าถัดไป"
            href={n < total ? pageHref(key, n + 1) : undefined}
            className={`inline-flex min-h-9 min-w-9 items-center justify-center border border-rule bg-sheet ${n < total ? "text-form hover:bg-tint" : "pointer-events-none opacity-40"}`}
          >
            <ChevronRight className="h-4 w-4" />
          </a>
        </span>
        {pq && <span className={`px-2 py-0.5 text-[13px] ${GRADE[pq.grade].cls}`}>คะแนน {pq.score}</span>}
        {st[n] && <span className="border border-form px-2 py-0.5 text-[13px] text-form">{STATUS[st[n]]}</span>}
      </div>
      <div className="grid flex-1 lg:grid-cols-2">
        <div className="min-h-[60vh] border-rule lg:border-r">
          {doc && doc.pdf_local === false ? (
            <p className="p-6 text-[15px] text-ink">
              PDF นี้ใหญ่เกินกว่าจะแสดงที่นี่ ·{" "}
              <a href={doc.source_url} rel="noreferrer" className="font-medium text-form underline underline-offset-4">
                เปิดต้นฉบับบนเว็บกรมสรรพสามิต
              </a>{" "}
              แล้วไปหน้า {n}
            </p>
          ) : (
            <iframe
              key={`${key}-${n}`}
              title={`PDF หน้า ${n}`}
              src={`/api/pdf?key=${encodeURIComponent(key)}#page=${n}&view=FitH&navpanes=0`}
              className="block h-full min-h-[60vh] w-full border-0 bg-tint"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          {pq && Object.keys(pq.flags).length > 0 && (
            <div className="border-b border-rule px-4 py-3 sm:px-5">
              <p className="text-[13px] font-medium text-form-soft">จุดที่น่าสงสัย (กดเพื่อไปที่ข้อความ)</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(pq.flags).map(([k, v]) => {
                  const ex = pq.ex?.[k];
                  const list = Array.isArray(ex) ? ex : [];
                  return (
                    <li key={k} className="flex flex-wrap items-center gap-1 text-[13px]">
                      <span className="bg-mark-wash px-1.5 py-0.5 text-ink">
                        {FLAG[k] || k}
                        {typeof v === "number" && v < 1 ? ` ${Math.round(v * 100)}%` : ` ${v}`}
                      </span>
                      {k !== "numbers" &&
                        list.map((s) => (
                          <button key={s} type="button" onClick={() => show(s)} className="border border-rule px-1.5 py-0.5 text-ink hover:bg-tint">
                            {s}
                          </button>
                        ))}
                      {k === "numbers" && <span className="text-ink-soft">PDF มี {list.join(", ")}</span>}
                      {k === "odd" && typeof ex === "string" && <span className="text-ink-soft">{ex}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="flex items-center gap-3 border-b border-rule px-4 py-2 text-[14px] sm:px-5">
            {[
              ["edit", "แก้ข้อความ"],
              ["diff", "เทียบกับ OCR เดิม"],
              ["history", `ประวัติ (${revs.length})`],
            ].map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                aria-pressed={view === k}
                className={`min-h-8 border-b-2 px-1 ${view === k ? "border-form font-medium text-form" : "border-transparent text-ink-soft hover:text-form"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {view === "edit" && (
            <textarea
              ref={ta}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              disabled={!doc || rec === undefined}
              aria-label={`ข้อความหน้า ${n}`}
              className="min-h-[50vh] w-full flex-1 resize-none bg-sheet px-4 py-3 font-[Sarabun] text-[17px] leading-[28px] text-ink outline-none sm:px-5"
            />
          )}
          {view === "diff" && (
            <div className="min-h-[50vh] flex-1 overflow-auto px-4 py-3 font-[Sarabun] text-[16px] leading-[26px] sm:px-5">
              {base === text ? (
                <p className="text-ink-soft">ยังไม่มีการแก้ไขจากข้อความ OCR เดิม</p>
              ) : (
                diffLines(base, text).map(([t, l], i) =>
                  t === " " ? (
                    <div key={i} className="whitespace-pre-wrap text-ink-soft">
                      {l || " "}
                    </div>
                  ) : (
                    <div key={i} className={`whitespace-pre-wrap ${t === "-" ? "bg-[#f6d5d2] text-ink line-through decoration-stamp" : "bg-[#d4ecd9] text-ink"}`}>
                      {t} {l || " "}
                    </div>
                  ),
                )
              )}
            </div>
          )}
          {view === "history" && (
            <ol className="min-h-[50vh] flex-1 divide-y divide-rule overflow-auto px-4 sm:px-5">
              {revs.length === 0 && <li className="py-3 text-ink-soft">ยังไม่มีใครตรวจหน้านี้</li>}
              {revs.map((r, i) => (
                <li key={i} className="py-3 text-[14px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <History className="h-4 w-4 text-form" aria-hidden="true" />
                    <span className="font-medium text-ink">ครั้งที่ {r.rev}</span>
                    <span className="text-ink-soft">{STATUS[r.status]}</span>
                    <span className="text-ink-soft">· {r.by}</span>
                    <span className="tnum text-ink-soft">· {when(r.at)}</span>
                    <button type="button" onClick={() => (setText(r.text), setView("edit"))} className="ml-auto text-form underline underline-offset-4">
                      ใช้ข้อความนี้
                    </button>
                  </div>
                  {r.note && <p className="mt-1 text-ink">{r.note}</p>}
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-tint px-4 py-3 sm:px-5">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="หมายเหตุ (ไม่บังคับ) เช่น แก้เลขข้อ ๑ ที่หาย"
              className="min-h-10 min-w-[12rem] flex-1 border border-rule bg-sheet px-3 text-[14px]"
            />
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => save("fixed")}
              title="⌘S / Ctrl+S"
              className="inline-flex min-h-10 items-center gap-1.5 border border-form bg-form px-4 text-[14px] font-medium text-sheet hover:bg-form-soft disabled:opacity-40"
            >
              <Save className="h-4 w-4" aria-hidden="true" /> บันทึกการแก้ไข
            </button>
            <button
              type="button"
              disabled={busy || dirty || !doc}
              onClick={() => save("approved")}
              className="inline-flex min-h-10 items-center gap-1.5 border border-form bg-sheet px-4 text-[14px] font-medium text-form hover:bg-tint disabled:opacity-40"
            >
              <Check className="h-4 w-4" aria-hidden="true" /> ถูกต้อง ไม่ต้องแก้
            </button>
            {dirty && (
              <button type="button" onClick={() => setText(current)} className="inline-flex min-h-10 items-center gap-1 px-2 text-[14px] text-ink-soft hover:text-stamp">
                <X className="h-4 w-4" aria-hidden="true" /> ยกเลิก
              </button>
            )}
            {busy && <Loader2 className="h-4 w-4 animate-spin text-form" />}
            {msg && <span className={`text-[14px] ${msg.startsWith("บันทึกไม่") ? "text-stamp" : "text-form"}`}>{msg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- admins invite reviewers ---------- */
function People({ me }) {
  const [list, setList] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("reviewer");
  const [msg, setMsg] = useState("");
  const load = () => fb.listReviewers().then(setList);
  useEffect(() => {
    load();
  }, []);
  const add = async (e) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setMsg("อีเมลไม่ถูกต้อง");
    try {
      await fb.addReviewer(email, role, me);
      setEmail("");
      setMsg("");
      load();
    } catch (err) {
      setMsg(String(err.code || err.message));
    }
  };
  return (
    <div className="max-w-[44rem] p-4 sm:p-6">
      <h1 className="text-[20px] font-semibold text-ink">ผู้ตรวจ</h1>
      <p className="mt-2 text-[14px] text-ink-soft">เพิ่มอีเมล Google (Gmail) ของคนที่ให้ตรวจเอกสาร ผู้ดูแลเพิ่มหรือลบผู้ตรวจได้</p>
      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" className="min-h-10 min-w-[16rem] flex-1 border border-rule px-3 text-[14px]" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="min-h-10 border border-rule bg-sheet px-2 text-[14px]">
          <option value="reviewer">ผู้ตรวจ</option>
          <option value="admin">ผู้ดูแล</option>
        </select>
        <button type="submit" className="inline-flex min-h-10 items-center gap-1.5 border border-form bg-form px-4 text-[14px] font-medium text-sheet hover:bg-form-soft">
          <UserPlus className="h-4 w-4" aria-hidden="true" /> เพิ่ม
        </button>
      </form>
      {msg && <p className="mt-2 text-[14px] text-stamp">{msg}</p>}
      <ul className="mt-5 divide-y divide-rule border-y border-rule">
        {(list || []).map((r) => (
          <li key={r.email} className="flex items-center gap-3 py-2.5 text-[14px]">
            <span className="flex-1 text-ink">{r.email}</span>
            <span className="text-ink-soft">{r.role === "admin" ? "ผู้ดูแล" : "ผู้ตรวจ"}</span>
            {r.email !== me && (
              <button type="button" onClick={() => fb.removeReviewer(r.email).then(load)} className="text-stamp underline underline-offset-4">
                ลบ
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
