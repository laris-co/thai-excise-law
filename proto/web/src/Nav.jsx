import { Map as MapIcon, MessageSquareText, PanelBottomOpen } from "lucide-react";

/* One navigation bar for both pages: the brand goes home, the two tabs switch pages. */
const ITEMS = [
  { key: "ask", href: "#/", label: "ถามข้อกฎหมาย", short: "ถาม", Icon: MessageSquareText },
  { key: "site", href: "#/site", label: "ตัวอย่างแชตบนเว็บไซต์", short: "แชตบนเว็บ", Icon: PanelBottomOpen },
  { key: "map", href: "#/map", label: "แผนที่ข้อมูล", short: "แผนที่", Icon: MapIcon },
];

// the first page: drop the saved answers (so it also works coming from another page) and tell an open Chat
const goHome = () => {
  try {
    sessionStorage.removeItem("turns");
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event("go-home"));
};

export default function Nav({ here, wide = false, inert }) {
  return (
    <div inert={inert} className="bg-form sm:-mx-6 sm:mb-6">
    <nav aria-label="เมนูหลัก" className={`mx-auto flex items-stretch justify-between gap-3 px-5 sm:px-6 ${wide ? "max-w-[93rem]" : "max-w-[55rem]"}`}>
      <a href="#/" onClick={goHome} className="hidden min-h-12 items-center whitespace-nowrap text-[16px] font-semibold text-sheet hover:underline md:flex">
        คราฟต์เบียร์ · สรรพสามิต
      </a>
      <ul className="flex w-full items-stretch justify-between md:w-auto md:justify-end">
        {ITEMS.map(({ key, href, label, short, Icon }) => {
          const on = here === key;
          return (
            <li key={key} className="flex">
              <a
                href={href}
                onClick={key === "ask" ? goHome : undefined}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-12 items-center gap-1.5 whitespace-nowrap border-b-[3px] px-2.5 text-[14px] sm:px-3 ${
                  on ? "border-sheet font-semibold text-sheet" : "border-transparent text-[#d7e6dc] hover:border-[#8fbfa2] hover:text-sheet"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
    </div>
  );
}
