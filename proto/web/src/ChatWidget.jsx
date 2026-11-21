import { useEffect, useRef, useState } from "react";
import { Maximize2, MessageCircle, Minus, X } from "lucide-react";

/* The chat as a pop-up in the corner, like a site chat. The window is an iframe of #/embed,
   so it gets the phone layout at any size and any site can embed the same page. */
export default function ChatWidget() {
  const [state, setState] = useState("closed"); // closed | open | min
  const [loaded, setLoaded] = useState(false);
  const launcher = useRef(null);

  // any page can open the pop-up: window.dispatchEvent(new Event("open-chat"))
  useEffect(() => {
    const on = () => {
      setLoaded(true);
      setState("open");
    };
    window.addEventListener("open-chat", on);
    return () => window.removeEventListener("open-chat", on);
  }, []);

  useEffect(() => {
    if (state !== "open") return;
    const onKey = (e) => e.key === "Escape" && setState("min");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  const open = () => {
    setLoaded(true);
    setState("open");
  };
  const hide = (to) => {
    setState(to);
    requestAnimationFrame(() => launcher.current?.focus());
  };

  return (
    <>
      {loaded && (
        <section
          role="dialog"
          aria-label="แชตถามข้อกฎหมาย"
          hidden={state !== "open"}
          className="fixed inset-0 z-50 flex flex-col border-form bg-sheet shadow-[0_12px_48px_rgb(10_30_20/0.35)] sm:inset-auto sm:right-5 sm:bottom-24 sm:h-[min(42rem,calc(100vh-8rem))] sm:w-[25rem] sm:border-2"
        >
          <header className="flex items-center gap-2 bg-form px-3 py-2 text-sheet">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sheet text-form">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 leading-5">
              <span className="block truncate text-[15px] font-semibold">ถามข้อกฎหมายสรรพสามิต</span>
              <span className="block truncate text-[13px] text-[#cfe3d6]">คราฟต์เบียร์ · สรรพสามิต · ตอบพร้อมที่มา</span>
            </span>
            <a href="#/" title="เปิดเต็มหน้า" aria-label="เปิดเต็มหน้า" className="inline-flex h-10 w-10 items-center justify-center hover:bg-[#ffffff22]">
              <Maximize2 className="h-4 w-4" />
            </a>
            <button type="button" onClick={() => hide("min")} title="ย่อ" aria-label="ย่อ" className="inline-flex h-10 w-10 items-center justify-center hover:bg-[#ffffff22]">
              <Minus className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => hide("closed")} title="ปิด" aria-label="ปิด" className="inline-flex h-10 w-10 items-center justify-center hover:bg-[#ffffff22]">
              <X className="h-5 w-5" />
            </button>
          </header>
          <iframe title="แชตถามข้อกฎหมาย" src="/#/embed" className="min-h-0 w-full flex-1 border-0 bg-sheet" />
        </section>
      )}
      <button
        ref={launcher}
        type="button"
        onClick={() => (state === "open" ? hide("min") : open())}
        aria-expanded={state === "open"}
        className={`fixed right-5 bottom-5 z-50 items-center gap-2 rounded-full bg-form py-3 pr-5 pl-4 text-[15px] font-semibold text-sheet shadow-[0_6px_24px_rgb(10_30_20/0.35)] hover:bg-ink ${state === "open" ? "hidden sm:inline-flex" : "inline-flex"}`}
      >
        <MessageCircle className="h-6 w-6" />
        {state === "open" ? "ย่อแชต" : state === "min" ? "แชตต่อ" : "ถามข้อกฎหมาย"}
      </button>
    </>
  );
}
