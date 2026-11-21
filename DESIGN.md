---
name: แบบสอบถามข้อกฎหมายสรรพสามิต (Thai excise-law search for craft brewers)
description: Excise-law answers set as a filled Thai government form, quoted from checked documents.
colors:
  desk: "#cfdad3"
  sheet: "#ffffff"
  field-tint: "#dbe8df"
  printed-rule: "#8fa596"
  form-green: "#174d34"
  form-green-soft: "#2c5240"
  ink: "#111412"
  ink-soft: "#2f3431"
  reading-amber: "#9a4d00"
  reading-wash: "#fbd99a"
  guide-yellow: "#ffe45c"
  asked-blue: "#1450b0"
  stamp-red: "#a3302a"
typography:
  title:
    fontFamily: "IBM Plex Sans Thai, Noto Sans Thai, Thonburi, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: "32px"
  entry:
    fontFamily: "IBM Plex Sans Thai, Noto Sans Thai, Thonburi, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: "32px"
  body:
    fontFamily: "IBM Plex Sans Thai, Noto Sans Thai, Thonburi, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "28px"
  label:
    fontFamily: "IBM Plex Sans Thai, Noto Sans Thai, Thonburi, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "20px"
  law:
    fontFamily: "Sarabun, TH Sarabun New, Noto Serif Thai, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.85
rounded:
  none: "0px"
spacing:
  gutter-mobile: "20px"
  gutter-desktop: "32px"
  field: "12px"
components:
  button-primary:
    backgroundColor: "{colors.form-green}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
  button-primary-disabled:
    backgroundColor: "{colors.printed-rule}"
    textColor: "{colors.ink-soft}"
  button-outline:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.form-green}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 12px"
  citation-number-active:
    backgroundColor: "{colors.reading-amber}"
    textColor: "{colors.sheet}"
    width: "40px"
---

# Design System: แบบสอบถามข้อกฎหมายสรรพสามิต

## Overview

**Creative North Star: "The Filled Government Form"**

The chatbot is a Thai government form (แบบฟอร์มราชการ) that the search fills in. Printed parts are in
form-green ink: labels, numbered fields, boxes, dotted writing lines and checkboxes. Everything the
search wrote is in ink-black, and the quoted law is set in Sarabun like the Royal Gazette it came from.
Each answer is a numbered ใบตอบ, not a chat bubble. The tone is official and calm. Craft
beer shows only in one small warmth: amber marks the citation being read.

Built from the direction contract at the top of `proto/web/index.html` (seed ae2a9615).

**Key Characteristics:**
- One white sheet on a grey-green desk, square corners everywhere.
- Numbered fields (๑ ๒ ๓ in Thai digits) carry the reading order.
- Checkboxes only where something is truly ticked: the status of a law, the staff toggle.
- Light theme only: members read in daylight, in a brewery office or on a phone.

## Colors

Restrained: neutrals plus form-green print; amber and red each have exactly one job.

### Primary
- **Form-Green Print** (#174d34): printed labels, field borders, the header rule, primary buttons, focus rings.
- **Form-Green Soft** (#2c5240): small printed captions inside fields (8.6:1 on white).

### Tertiary
- **Reading Amber** (#9a4d00), with **Reading Wash** (#fbd99a): the citation open in the reader, its number cell, its pages in the page rail, and the highlighted passage. Nothing else.
- **Stamp Red** (#a3302a): "ยกเลิกแล้ว" and "ไม่พบในเอกสารในคลัง" only.

### Neutral
- **Desk** (#cfdad3): page background behind the sheet.
- **Sheet** (#ffffff): the form.
- **Field Tint** (#dbe8df): printed band rows (status bar, ใบตอบ header, citation footer, reader toolbars).
- **Printed Rule** (#8fa596): hairlines between fields and the dotted writing lines.
- **Ink** (#111412) and **Ink Soft** (#2f3431): filled-in entries and secondary entries.

- **Guide Yellow** (#ffe45c): the span the reranker reads as the best answer in each quote, and the member's words in the question that sit inside it.
- **Asked Blue** (#1450b0): underline under the member's own words wherever they appear; legal terms the search added get a dashed form-green underline.

Colours were deepened on 2026-11-21 after feedback that the first palette was too pale ("สีมันจาง สีมันอ่อนไปหน่อย").

### Named Rules
**The One Leg Rule.** Amber marks only what is being read right now. If two things are amber, one is wrong.

**The Stamp Rule.** Red means cancelled or not found. Never errors of the UI's own, never emphasis.

## Typography

**UI Font:** IBM Plex Sans Thai (self-hosted via @fontsource, Thai + Latin subsets)
**Law Font:** Sarabun (self-hosted), the face Thai government documents are set in

**Character:** a plain workhorse sans for the form; the quoted law switches to Sarabun so a member can see where the document's own words begin.

### Hierarchy
- **Title** (600, 22px mobile / 26px desktop, 32px line): the form title, once.
- **Entry** (400, 18px, 32px line): the member's question on its dotted line.
- **Law** (Sarabun 400, 17px, 1.85): quoted clauses and the reader body, max 68ch.
- **Body** (400, 15px, 28px line): filled entries, field values, refusal text.
- **Label** (500, 13px): numbered field labels in form-green. Captions in fields at 12px.

### Named Rules
**The Verbatim Rule.** Only document text is set in Sarabun. UI copy never borrows it.

## Layout

- One sheet, max 52rem, centred; at 390 px it runs edge to edge with no desk margin.
- Gutters 20px mobile, 32px from `sm`.
- Each ใบตอบ: tinted header row, then fields ๑ คำถาม, ๒ คำในกฎหมายที่ใช้ค้นเพิ่ม, ๓ ข้อความจากเอกสาร.
- Citation grid: 2 columns on mobile, 4 from `sm` (ข้อ/มาตรา, หน้า, มีผล, สถานะ).
- After the first answer, the question field becomes a sticky bottom row (`scroll-padding-bottom: 7rem`).
- Reader: a right-hand sheet at `lg` (min(46rem, 48vw)), and the main sheet makes room; below `lg` it is a full-screen dialog.

## Elevation & Depth

Flat paper. The sheet has one soft ambient shadow (`0 2px 14px rgb(20 40 30 / 0.10)`) to lift it off the desk; the reader sheet a deeper one (`0 8px 40px rgb(20 40 30 / 0.22)`). Inside the sheet, depth is borders and tint bands, never shadow.

## Shapes

Square corners throughout (`rounded.none`): fields, buttons, checkboxes, page buttons. Borders are 1px printed rules; the header and each ใบตอบ open with a 2px form-green rule. Staff-only content sits in a dashed box, as on a real form's "สำหรับเจ้าหน้าที่".

## Components

- **Field**: tiny form-green-soft caption over an ink value, separated by printed rules.
- **Question field**: textarea on a dotted writing line, autosizing; Enter sends, Shift+Enter breaks.
- **Example questions**: ruled lines, each with an arrow that strengthens on hover and focus. One click sends.
- **Citation card**: number cell, title field, the 4-field grid, the quoted law, then a tinted footer with "อ่านข้อความเต็มจากเอกสาร" and "PDF ต้นฉบับ".
- **Status boxes**: ☑ ใช้บังคับ / ☐ ยกเลิกแล้ว, drawn with Lucide Check; cancelled ticks in stamp red.
- **Refusal**: a straight red-bordered result field, a plain list of what to try, and a re-ask button with the legal terms.
- **Staff box** (reviewer mode, off by default): dashed box with base and rerank side by side; hovering or focusing a row highlights it.
- **Reader**: title, effect date, status; a page rail with the cited pages in amber; OCR page text with the cited passage washed and underlined in amber; footer with an OCR caveat and the PDF link. Esc closes; ← and → turn pages.
- **Loading**: pulsing tinted bars where the answer will be, plus a cold-start line after 4 s.
- **Navigation**: a solid form-green bar across the top of every page; the brand goes home, tabs ถามข้อกฎหมาย / แผนที่ข้อมูล.
- **Chat pop-up**: a round launcher bottom-right on every page except the full chat; it opens a 25rem window (full screen on phones) holding `#/embed` in an iframe. The member's question shows as a right-aligned form-green bubble; answers keep the form layout.
- **Search map** (`#/map`, staff): one colour per search stage, the same on the map, the step list and the legend.

## Do's and Don'ts

- Do keep every answer traceable: title, ข้อ, page, effect date, status, PDF.
- Do use Lucide icons at 14 to 20px, one stroke weight.
- Don't add chat bubbles, avatars or an assistant persona.
- Don't use rounded cards, gradients, glass or eyebrow labels above headings.
- Don't draw an empty checkbox on anything that is not ticked.
- Don't add beer imagery to the sheet. Warmth stays in amber.
