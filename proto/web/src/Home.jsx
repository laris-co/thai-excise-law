import { ArrowRight, BookOpenText, Map as MapIcon, MessageCircle } from "lucide-react";
import Nav from "./Nav.jsx";

/* A stand-in for a website, so the chat can be tried the way members will
   meet it: a page of the site with the chat button in the corner. Content here is a placeholder. */
const openChat = () => window.dispatchEvent(new Event("open-chat"));

export default function Home() {
  return (
    <div className="min-h-screen px-0 sm:px-6 sm:pb-24">
      <Nav here="site" wide />
      <main className="mx-auto max-w-[90rem] border-form bg-sheet shadow-[0_2px_14px_rgb(20_40_30/0.10)] sm:border">
        <div className="border-b border-rule bg-tint px-5 py-1.5 text-[13px] text-ink-soft sm:px-8">
          หน้าตัวอย่างเว็บไซต์ สำหรับทดลองวางแชต · ข้อความในหน้านี้ยังไม่ใช่ของจริง
        </div>
        <section className="border-b-2 border-form px-5 py-8 sm:px-8 sm:py-10">
          <h1 className="text-[26px] leading-9 font-semibold text-form sm:text-[32px] sm:leading-[2.75rem]">คราฟต์เบียร์ · สรรพสามิต</h1>
          <p className="mt-2 max-w-[40rem] text-[17px] leading-8 text-ink">
            มีคำถามเรื่องภาษีสรรพสามิต ใบอนุญาต ฉลาก หรือแสตมป์? ถามได้ด้วยภาษาธรรมดา ระบบตอบด้วยข้อความจากเอกสารในคลัง
            พร้อมเลขข้อ หน้า และลิงก์ PDF ต้นฉบับให้ตรวจเอง
          </p>
          <button
            type="button"
            onClick={openChat}
            className="mt-5 inline-flex min-h-12 items-center gap-2 bg-form px-5 text-[16px] font-semibold text-sheet hover:bg-ink"
          >
            <MessageCircle className="h-5 w-5" /> เปิดแชตถามข้อกฎหมาย
          </button>
          <p className="mt-2 text-[14px] text-ink-soft">หรือกดปุ่มแชตที่มุมขวาล่างได้ทุกหน้า</p>
        </section>
        <ul className="grid sm:grid-cols-3">
          {[
            { Icon: MessageCircle, t: "ถามข้อกฎหมาย", d: "แชตมุมจอ ตอบพร้อมที่มา ไม่เดา", go: openChat },
            { Icon: BookOpenText, t: "เปิดเต็มหน้า", d: "แบบฟอร์มเต็มจอ อ่านคำตอบยาวสะดวก", href: "#/" },
            { Icon: MapIcon, t: "แผนที่ข้อมูล", d: "สำหรับเจ้าหน้าที่ ดูว่าระบบค้นอย่างไร", href: "#/map" },
          ].map(({ Icon, t, d, go, href }) => {
            const inner = (
              <>
                <Icon className="h-5 w-5 text-form" />
                <span className="mt-2 flex items-center gap-1 text-[16px] font-semibold text-ink">
                  {t} <ArrowRight className="h-4 w-4 text-form" />
                </span>
                <span className="mt-1 text-[14px] leading-6 text-ink-soft">{d}</span>
              </>
            );
            const cls = "flex h-full w-full flex-col items-start px-5 py-5 text-left hover:bg-tint sm:px-6";
            return (
              <li key={t} className="border-b border-rule sm:border-r sm:border-b-0 sm:last:border-r-0">
                {go ? <button type="button" onClick={go} className={cls}>{inner}</button> : <a href={href} className={cls}>{inner}</a>}
              </li>
            );
          })}
        </ul>
        <footer className="border-t border-rule px-5 py-3 text-[13px] leading-5 text-form-soft sm:px-8">
          ต้นแบบนี้ยังไม่ใช่คำแนะนำทางกฎหมาย ตรวจกับ PDF ต้นฉบับทุกครั้งก่อนใช้
        </footer>
      </main>
    </div>
  );
}
