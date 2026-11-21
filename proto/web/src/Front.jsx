import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  FileSearch,
  Factory,
  FileText,
  Gavel,
  Home as HomeIcon,
  Percent,
  Quote,
  ScrollText,
  Ship,
  Store,
  Tag,
  Truck,
} from "lucide-react";

/* The first page under the question box: topics to tap, the key numbers already checked against the
   printed page, the newest documents, and how an answer is made. Every number here was read off the
   original PDF page (QA run 2026-11-21, proto/QA-2026-11-21.md); nothing is invented. */

export const TOPICS = [
  { Icon: Factory, title: "เปิดโรงเบียร์ · ใบอนุญาตผลิต", img: "/img/produce.jpg", qs: ["เปิดโรงเบียร์ขนาดเล็กต้องขออนุญาตอะไรบ้าง", "ค่าธรรมเนียมใบอนุญาตผลิตเบียร์เท่าไร", "ต้องยื่นต่ออายุใบอนุญาตผลิตเบียร์ก่อนหมดอายุกี่วัน"] },
  { Icon: Percent, title: "ภาษีและการยื่นแบบ", img: "/img/tax.jpg", qs: ["อัตราภาษีเบียร์ตอนนี้เท่าไร", "ยื่นภาษีทางอินเทอร์เน็ตต้องใช้แบบอะไร"] },
  { Icon: Tag, title: "ฉลากและแสตมป์", img: "/img/label.jpg", qs: ["ต้องขออนุมัติฉลากเบียร์ก่อนขายไหม", "ต้องปิดแสตมป์สุราให้หมดในครั้งเดียวไหม"] },
  { Icon: Store, title: "ขายเบียร์", img: "/img/sell.jpg", qs: ["ขายเบียร์ต้องมีใบอนุญาตขายสุราประเภทไหน"] },
  { Icon: HomeIcon, title: "ทำกินเอง ไม่ได้ขาย", img: "/img/home.jpg", qs: ["ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม"] },
  { Icon: Ship, title: "นำเข้าเบียร์", img: "/img/import.jpg", qs: ["นำเข้าเบียร์ต้องขอใบอนุญาตอะไร"] },
  { Icon: Truck, title: "ขนเบียร์ออกจากโรงงาน", img: "/img/transport.jpg", qs: ["ขนเบียร์ออกจากโรงงานต้องมีเอกสารอะไร"] },
  { Icon: Gavel, title: "บทลงโทษ", img: "/img/penalty.jpg", qs: ["ผลิตเบียร์โดยไม่มีใบอนุญาตมีโทษอะไร"] },
];

// value, what it is, the document and PDF page it was checked on, the question that opens the answer
const FACTS = [
  { v: "60,000", u: "บาท / ฉบับ", what: "ใบอนุญาตผลิตเบียร์เพื่อการค้า ประเภทที่ 1 และ 2", key: "9469_7169", page: 1,
    src: "กฎกระทรวงค่าธรรมเนียม (ฉบับที่ 3) พ.ศ. 2568", q: "ค่าธรรมเนียมใบอนุญาตผลิตเบียร์เท่าไร" },
  { v: "54,000", u: "บาท / ฉบับ", what: "ใบอนุญาตผลิตเบียร์ ประเภทที่ 3", key: "9469_7169", page: 1,
    src: "กฎกระทรวงค่าธรรมเนียม (ฉบับที่ 3) พ.ศ. 2568", q: "ค่าธรรมเนียมใบอนุญาตผลิตเบียร์เท่าไร" },
  { v: "360", u: "บาท / ฉบับ", what: "ใบอนุญาตผลิตสุราแช่ที่มิใช่เพื่อการค้า", key: "9469_7169", page: 1,
    src: "กฎกระทรวงค่าธรรมเนียม (ฉบับที่ 3) พ.ศ. 2568", q: "ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม" },
  { v: "22% + 430", u: "บาท / ลิตรแอลกอฮอล์บริสุทธิ์", what: "อัตราภาษีเบียร์ ตามมูลค่าและตามปริมาณ", key: "8286_5650", page: 1,
    src: "กฎกระทรวงพิกัดอัตราภาษีสรรพสามิต (ฉบับที่ 39) พ.ศ. 2567", q: "อัตราภาษีเบียร์ตอนนี้เท่าไร" },
  { v: "200", u: "ลิตร / ปี", what: "เพดานการผลิตที่นับว่าไม่ใช่เพื่อการค้า และต้องไม่ได้ประโยชน์ตอบแทน", key: "9468_7168", page: 1,
    src: "กฎกระทรวงการผลิตสุรา พ.ศ. 2568 ข้อ 2", q: "ทำเบียร์กินเองที่บ้านผิดกฎหมายไหม" },
  { v: "90", u: "วัน", what: "ยื่นต่ออายุใบอนุญาตผลิตภายในก่อนวันหมดอายุ", key: "9468_7168", page: 2,
    src: "กฎกระทรวงการผลิตสุรา พ.ศ. 2568 ข้อ 5", q: "ต้องยื่นต่ออายุใบอนุญาตผลิตเบียร์ก่อนหมดอายุกี่วัน" },
];

const STEPS = [
  { Icon: FileSearch, t: "ค้นในคลังเอกสาร", d: "ค้นทั้งคำที่ท่านพิมพ์และคำกฎหมายที่ตรงกัน ฉบับที่ใช้บังคับล่าสุดขึ้นก่อน" },
  { Icon: Quote, t: "ยกข้อความมาตรง ๆ", d: "ไม่แต่งคำตอบเอง ถ้าไม่พบส่วนที่ตอบได้จริง ระบบจะบอกว่าไม่พบ" },
  { Icon: BadgeCheck, t: "ตรวจกับหน้าจริง", d: "ทุกคำตอบมีชื่อเอกสาร ข้อ หน้า วันที่มีผล และเปิด PDF หน้านั้นได้ทันที" },
];

const TYPES = ["พระราชบัญญัติ", "กฎกระทรวง", "ประกาศ", "ระเบียบ", "คำสั่ง"];

const thDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
};

function Heading({ children, note }) {
  return (
    <div className="mb-3">
      <h2 className="text-[17px] leading-7 font-semibold text-form">{children}</h2>
      {note && <p className="text-[13px] leading-5 text-ink-soft">{note}</p>}
    </div>
  );
}

function Topics({ ask }) {
  return (
    <section aria-labelledby="topics-h" className="px-5 pt-2 pb-6 sm:px-8">
      <div className="flex items-end justify-between gap-6">
        <Heading note="แตะคำถาม ระบบจะตอบพร้อมหน้าเอกสารจริง · ภาพประกอบวาดด้วย AI">
          <span id="topics-h">เลือกเรื่องที่อยากรู้</span>
        </Heading>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TOPICS.map(({ title, img, qs }) => (
          <li key={title} className="flex flex-col border border-rule bg-sheet">
            <div className="flex items-center gap-3 border-b border-rule bg-[#fbf8f1] px-3 py-2">
              <img src={img} alt="" width="64" height="64" loading="lazy" className="h-16 w-16 shrink-0 border border-rule/60 object-cover" />
              <h3 className="text-[16px] leading-6 font-semibold text-form">{title}</h3>
            </div>
            <ul className="flex-1 divide-y divide-rule/60">
              {qs.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => ask(q)}
                    className="group flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[15px] leading-6 text-ink hover:bg-tint/60 hover:text-form"
                  >
                    <span>{q}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-rule transition-transform group-hover:translate-x-0.5 group-hover:text-form" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Facts({ ask }) {
  return (
    <section aria-labelledby="facts-h" className="border-t border-rule bg-tint/50 px-5 py-6 sm:px-8">
      <Heading note="ทุกตัวเลขตรวจกับหน้า PDF ต้นฉบับแล้ว แตะการ์ดเพื่อดูข้อความเต็ม หรือเปิดหน้า PDF">
        <span id="facts-h">ตัวเลขที่ถามกันบ่อย</span>
      </Heading>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FACTS.map((f) => (
          <li key={f.what} className="flex flex-col border border-form bg-sheet">
            <button type="button" onClick={() => ask(f.q)} className="group flex-1 px-4 pt-3.5 pb-3 text-left hover:bg-tint/40">
              <span className="tnum block text-[28px] leading-9 font-semibold text-mark">{f.v}</span>
              <span className="block text-[13px] font-medium text-form-soft">{f.u}</span>
              <span className="mt-1.5 block text-[15px] leading-6 text-ink">{f.what}</span>
            </button>
            <div className="flex items-center justify-between gap-2 border-t border-rule px-4 py-2 text-[13px] leading-5">
              <span className="min-w-0 text-ink-soft">{f.src}</span>
              <a
                href={`/api/pdf?key=${f.key}#page=${f.page}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-medium text-form underline decoration-rule underline-offset-4 hover:text-ink"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" /> PDF น.{f.page} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Library() {
  const [latest, setLatest] = useState(null);
  const [counts, setCounts] = useState({});
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    fetch("/api/docs?q=สุรา&k=40")
      .then((r) => r.json())
      .then((d) => setLatest({ ...d, docs: d.docs.filter((x) => x.in_force && x.effect && x.effect <= today).slice(0, 5) }))
      .catch(() => setLatest({ total: 0, docs: [] }));
    TYPES.forEach((t) =>
      fetch(`/api/docs?q=${encodeURIComponent(t)}&k=1`)
        .then((r) => r.json())
        .then((d) => setCounts((c) => ({ ...c, [t]: d.total })))
        .catch(() => {}),
    );
  }, []);
  const max = Math.max(1, ...Object.values(counts));
  return (
    <section aria-labelledby="lib-h" className="grid gap-6 border-t border-rule px-5 py-6 sm:px-8 lg:grid-cols-[1.6fr_1fr]">
      <div>
        <Heading note="เรื่องสุรา ที่มีผลแล้วและยังใช้บังคับ เรียงจากวันที่มีผลล่าสุด">
          <span id="lib-h">เอกสารเรื่องสุราล่าสุด</span>
        </Heading>
        <ul className="divide-y divide-rule border-y border-rule">
          {(latest?.docs || []).map((d) => (
            <li key={d.key}>
              <a
                href={`/api/pdf?key=${d.key}#page=1`}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-3 py-2.5 hover:bg-tint/40"
              >
                <ScrollText className="mt-1 h-4 w-4 shrink-0 text-form-soft" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[15px] leading-6 text-ink group-hover:text-form">{d.title}</span>
                  <span className="tnum text-[13px] text-ink-soft">
                    {d.type} · มีผล {thDate(d.effect)}
                  </span>
                </span>
                <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-rule group-hover:text-form" aria-hidden="true" />
              </a>
            </li>
          ))}
          {!latest && [0, 1, 2].map((i) => <li key={i} className="pending my-3 h-10 bg-tint" />)}
        </ul>
      </div>
      <div>
        <Heading note="773 ฉบับ จากเว็บกฎหมายกรมสรรพสามิต">คลังมีอะไรบ้าง</Heading>
        <ul className="space-y-2.5">
          {TYPES.map((t) => (
            <li key={t} className="text-[14px]">
              <div className="flex justify-between">
                <span className="text-ink">{t}</span>
                <span className="tnum font-medium text-form">{counts[t] != null ? counts[t].toLocaleString("th-TH") : "…"}</span>
              </div>
              <div className="mt-1 h-2 bg-tint" aria-hidden="true">
                <div className="h-2 bg-form transition-[width] duration-500" style={{ width: `${((counts[t] || 0) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] leading-5 text-ink-soft">นับจากคำในชื่อเอกสาร ฉบับหนึ่งอาจนับได้มากกว่าหนึ่งประเภท</p>
      </div>
    </section>
  );
}

function How() {
  return (
    <section aria-labelledby="how-h" className="border-t border-rule px-5 py-6 sm:px-8">
      <Heading>
        <span id="how-h">ระบบตอบอย่างไร</span>
      </Heading>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ Icon, t, d }, i) => (
          <li key={t} className="flex gap-3">
            <span className="tnum inline-flex h-9 w-9 shrink-0 items-center justify-center border-2 border-form text-[15px] font-semibold text-form">
              {i + 1}
            </span>
            <div>
              <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                <Icon className="h-4 w-4 text-form" aria-hidden="true" /> {t}
              </h3>
              <p className="mt-0.5 text-[14px] leading-6 text-ink-soft">{d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Hero() {
  return (
    <figure className="relative mx-5 mb-2 overflow-hidden border border-rule bg-[#fbf8f1] sm:mx-8">
      <img
        src="/img/hero.jpg"
        alt="ภาพประกอบ: หม้อต้มทองแดงและถังหมักของโรงเบียร์ ขวดเบียร์และแก้วเบียร์ หนังสือกฎหมายเปิดอยู่ ตราประทับ และแว่นขยาย"
        width="1800"
        height="600"
        className="block aspect-[3/1] w-full object-cover"
      />
      <figcaption className="absolute right-2 bottom-1.5 bg-sheet/85 px-1.5 text-[11px] text-ink-soft">ภาพประกอบวาดด้วย AI</figcaption>
    </figure>
  );
}

export default function Front({ ask }) {
  return (
    <>
      <Topics ask={ask} />
      <Facts ask={ask} />
      <Library />
      <How />
    </>
  );
}
