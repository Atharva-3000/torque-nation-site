# Torque Nation — Design System v1.0

The single reference for how Torque Nation looks, reads and behaves across the public site, the admin panel and printed invoices.
**Tokens live in `public/css/tokens.css`.** Components live in `public/css/components.css`.
You can see everything rendered at **`/design-system`** when the server is running.

Rule zero: if a value isn't a token, don't use it. If you need a new one, add it to `tokens.css` and document it here first.

---

## 1. Brand idea

**"Torqued to spec."**

A premium workshop is defined by precision, not by noise. Every bolt has a number, and we hit it. The visual language comes from the tools of that precision: torque-wrench scales, tachometer redlines, spec sheets, and the heat tint on a titanium exhaust.

| We are | We are not |
|---|---|
| Measured, specific, calm | Loud, "beast mode", flame decals |
| Engineering confidence | Racing cosplay |
| Honest about price and process | "Call for price" on everything |
| Dark workshop, bright work-light | Neon gaming aesthetic |

### Voice
- Say what we do in plain words: "We check valve clearance and replace shims where it's out of spec." Not "Precision engine wellness solutions."
- Use numbers when we have them (hours, km intervals, ₹ ranges). Never invent them (no "50-point check").
- Punctuation: hyphens only. No em dashes or en dashes anywhere visible, including ranges (`450-700cc`, `2-4 h`). Use the middle dot sparingly, at most one per line.
- One label per intent: **Book a service** (booking), **WhatsApp us** (chat), **Call [number]**. Don't invent variants.
- Hinglish is fine in WhatsApp copy, never on the site.
- No fake reviews, no fake counters, no stock "happy customer" photos.

---

## 2. Colour

Dark-first. The site is a workshop at night with one work-light on.

| Token | Hex | Use |
|---|---|---|
| `--ink-950` / `--bg` | `#0a0b0d` | Page background |
| `--ink-900` / `--surface` | `#101216` | Cards, panels |
| `--ink-850` / `--surface-2` | `#14171b` | Raised panels, inputs |
| `--ink-800` / `--surface-3` | `#191c21` | Hover surfaces, table headers |
| `--ink-700` / `--line` | `#22262d` | Default 1px borders |
| `--ink-600` / `--line-strong` | `#2e333b` | Emphasised borders, ticks |
| `--steel-400` / `--text-muted` | `#8b929d` | Secondary text, captions |
| `--steel-300` / `--text-soft` | `#a9afb8` | Body copy on dark when long-form |
| `--bone-100` / `--text` | `#eeeae2` | Primary text |
| `--bone-50` | `#f7f5f0` | Invoice paper tone |
| `--redline-500` / `--accent` | `#ff4f1a` | **The** accent |
| `--heat-tint` | gradient | Decorative hairlines only |

**Accent discipline.** Redline appears at most in: the primary CTA, active nav state, and one highlighted figure per viewport. If two things on screen are redline, one of them is wrong.

**Heat-tint** (gold → bronze → violet → blue, the colours of heated titanium) is used only as a 1–2px line: under the logo, at the top of the footer, as the focus glow on the hero readout. Never as a fill, never as text.

**Status colours** (`--ok`, `--warn`, `--danger`, `--info`) exist for the admin panel only (paid / partial / unpaid / estimate). They never appear on the public site.

**Contrast.** `--text` on `--bg` = 15.9:1. `--text-muted` on `--bg` = 6.4:1 (AA for body). `--on-accent` on `--accent` = 6.9:1. Don't put `--text-muted` on `--surface-3` below 14px.

---

## 3. Typography

| Role | Family | Settings |
|---|---|---|
| Display | **Archivo** (variable) | `font-stretch: 125%`, weight 800, `letter-spacing: -0.02em`, uppercase for hero only |
| Body / UI | **Instrument Sans** | 400 / 500 / 600 |
| Data / spec | **JetBrains Mono** | 400 / 500, tabular numbers |

Why: expanded Archivo reads like the lettering on a fairing or a tank badge, with width and confidence and no gimmicks. Instrument Sans is neutral but warmer than the usual defaults. Mono is for anything a technician would write on a job card: prices, km, Nm, part numbers, invoice numbers.

### Scale (fluid, 360 → 1440px)

| Token | Range | Use |
|---|---|---|
| `--fs-display-xl` | 48 → 116px | Home hero only |
| `--fs-display-l` | 36 → 76px | Page heroes |
| `--fs-h1` | 32 → 52px | Section titles |
| `--fs-h2` | 24 → 36px | Sub-sections |
| `--fs-h3` | 19 → 24px | Card titles |
| `--fs-h4` | 17px | Small headings |
| `--fs-lede` | 17 → 21px | Intro paragraphs |
| `--fs-body` | 16px | Body |
| `--fs-sm` | 14px | UI, tables |
| `--fs-xs` | 12px | Captions |
| `--fs-micro` | 11px | Eyebrows (mono, uppercase, `0.14em` tracking) |

Rules:
- **Eyebrows are rationed:** at most one per three sections (the hero counts as one). A headline alone is usually enough.
- Section headers stack vertically (headline, then lede). No "big headline left, small paragraph right" split headers.
- Max line length: 68ch for body, 22ch for display.
- Prices and quantities always use `font-variant-numeric: tabular-nums`.
- Eyebrows (`.eyebrow`) are mono, uppercase, muted, preceded by a short tick mark. They label; they never shout.

---

## 4. Space and layout

4px base. Tokens `--s-1` (4) … `--s-10` (128). Sections use `--section-y` (64 → 128px).

- Container: `1320px` max, `--gutter` 16 → 32px. Narrow container `860px` for long text.
- Grid: 12 columns on desktop, 6 on tablet, 4 on mobile (`.grid` + `.col-*` helpers are intentionally **not** provided; use CSS grid with `repeat(auto-fit, minmax(...))` per component).
- Mobile first. Every layout must work at 360px with no horizontal scroll.

---

## 5. Shape, borders, elevation

Machined, not soft.
- Radius: `--r-1` 2px (buttons, inputs), `--r-2` 4px (cards), `--r-3` 8px (modals). `--r-pill` only for status chips.
- Separation comes from **1px borders** (`--line`), not shadows.
- Shadows only on overlays (`--shadow-overlay`) and on the invoice paper preview (`--shadow-print`).

---

## 6. Signature elements

1. **Tick scale** (`--ticks`, `.ticks`). A torque-wrench scale: minor ticks every 8px, major every 40px. Used as section dividers and under eyebrows. It is the brand's "texture"; don't add other patterns.
2. **Spec readout** (`.readout`). A mono key/value panel like a dash display: `LABEL ........ VALUE`. Used for service facts (time, interval, what's included).
3. **Step numbers.** Only the 4-step process uses `01`-`04`, because the order is real. Cards and sections are never numbered.
4. **Redline bar.** One 3px redline bar on the active nav item and on the top of the selected pricing column.

---

## 7. Components

All in `components.css`, all shown on `/design-system`.

| Component | Class | Notes |
|---|---|---|
| Button | `.btn` + `.btn--primary` / `--secondary` / `--ghost` / `--danger`, sizes `--sm` `--lg`, `.btn--block` | Primary = redline fill. One primary per view. |
| Eyebrow | `.eyebrow` | Mono micro label with tick |
| Section head | `.section-head` (eyebrow + h2 + `.lede`) | |
| Card | `.card`, `.card--interactive` | Border, no shadow; interactive lifts border colour on hover |
| Service card | `.service-card` | Index number, title, summary, readout |
| Readout | `.readout` > `.readout__row` > `dt`/`dd` | Mono, dotted leader |
| Price table | `.price-table` | Class A/B/C columns, tabular nums, "On quote" state |
| Chip / Badge | `.chip`, `.badge--ok/warn/danger/info/neutral` | Badges = admin status |
| Brand tile | `.brand-tile` | Logo image or typographic wordmark fallback, monochrome |
| Field | `.field` > `label` + `.input` / `.select` / `.textarea`, `.field__hint` | 44px min height |
| Table | `.table` | Admin lists, invoice lines |
| Alert / Toast | `.alert`, `.toast` | |
| Steps | `.steps` > `.step` | Process timeline |
| Stat | `.stat` | Admin dashboard figures |

### States
Every interactive component defines: default, hover, focus-visible (2px `--focus` outline, 2px offset), active, disabled (40% opacity, no pointer). Never remove focus outlines.

---

## 8. Motion

- `--t-fast` 120ms for hover colour. `--t-base` 200ms for UI. `--t-slow` 420ms for reveals.
- Easing: `--ease-out` for anything entering.
- Reveal on scroll: 12px rise + fade, once. No parallax, no scroll-jacking.
- `prefers-reduced-motion` zeroes all durations (handled in tokens).

---

## 9. Imagery

- **Priority:** your own workshop and customer-bike photos (with permission). Shoot under one hard work-light against dark backgrounds; desaturate slightly.
- **Until then:** freely licensed model photos from Wikimedia Commons, credited on `/credits` (sources in `lib/image-credits.json`). They show models we work on and must never be captioned as customer bikes or our workshop.
- No AI-generated "customer bikes", no stock photos of other workshops.
- Home hero photo is set in Admin → Settings. With no photo, the hero falls back to the tachometer graphic, whose geometry is computed in `gaugeSvg()` (one angle function for scale, redline and needle).
- Brand logos are shown **monochrome** (`filter: grayscale(1) brightness(1.7)`) and turn full colour on hover. Logo wall = logos only, no category labels under them. Official files live in `public/img/brands/` (Wikimedia Commons public-domain files or the brand's own site). Brands without a file fall back to a set-in-type wordmark. Wording is "Brands we fit", which makes no claim of partnership.

---

## 10. Print (invoices and estimates)

Invoices switch to a light theme: `--paper` background, `--ink-950` text, 1px `#d9d6cf` rules. A4 portrait, 14mm margins, `invoice.css`. The redline accent appears once (document title rule). All money is right-aligned, tabular, ₹ with Indian digit grouping (₹1,23,456.00).

---

## 11. Accessibility checklist

- [ ] Text contrast ≥ 4.5:1 (body) / 3:1 (≥ 24px)
- [ ] Focus visible on every interactive element
- [ ] Hit targets ≥ 44×44px
- [ ] Forms: every input has a `<label>`; errors are announced via `aria-live`
- [ ] Nav works by keyboard; mobile menu traps nothing and closes on Esc
- [ ] Images have `alt`; decorative SVG has `aria-hidden="true"`
