# Foundry Planning — Design System

> Brand and UI reference for Claude Code. **These tokens are the source of truth.** They mirror `src/app/globals.css` and `src/brand/tokens.ts` in the codebase. Don't invent new colors, fonts, sizes, or radii — use what's here.

---

## 1. Brand at a glance

- **Name:** Foundry Planning (short: **Foundry.** with a colored period; mark: **FP**)
- **Tagline:** *Cash-flow planning, calibrated for advisors.*
- **Personality:** technical, precise, dimensional, warm. Industrial CAD tool meets editorial UI. Confident, calibrated, never flashy.
- **Palette anchor:** **Amber accent** on **near-black paper**, with cream as the light alternative.
- **Type system:** **Inter** (display + UI) + **JetBrains Mono** (labels, code, tabular data).
- **Visual signatures:**
  - Dimensional FP mark with extruded amber sides
  - Monospace eyebrows in `UPPERCASE WIDE-TRACKED` style (0.08em)
  - Hairline borders (`1px solid var(--color-hair)`) on cards
  - Tabular nums (`font-feature-settings: "tnum"`) for all financial figures
  - Numbered sections (`01 · `, `02 · `) prefixed in mono

---

## 2. Logo & marks

### Files (relative to project root)

```
assets/
  fp-icon.svg                  # Primary — dimensional FP on dark card (1254×1254 viewBox)
  fp-mark-color.svg            # FP only, full color, transparent bg
  fp-mark-black.svg            # FP only, solid black, transparent bg
  fp-mark-white.svg            # FP only, solid white, transparent bg
  fp-icon-flat.svg             # Flat (non-dimensional) FP, dark card
  fp-icon-mono-light.svg       # Mono FP, white on black
  fp-icon-mono-dark.svg        # Mono FP, black on white
  fp-mark-only.svg             # Alias of fp-mark-color.svg
  wordmark-light.svg           # "Foundry." text only, light fg (for dark bg)
  wordmark-dark.svg            # "Foundry." text only, dark fg (for light bg)
  lockup-horizontal.svg        # Icon + Foundry. + PLANNING — dark bg
  lockup-horizontal-light.svg  # Same, on cream bg
  lockup-horizontal-mono.svg   # Same, pure B&W
  lockup-stacked.svg           # Centered stack — dark bg
  lockup-stacked-light.svg     # Same, on cream bg
  lockup-stacked-mono.svg      # Same, pure B&W
  favicon.svg                  # 32px-optimized
  light/                       # Cream-bg variants of everything above
  icons/                       # PNG exports: 16, 32, 48, 64, 128, 180, 192, 256, 512, 1024
    apple-touch-icon.png       # 180×180
    favicon-16.png / 32.png / 48.png
    icon-192.png / icon-512.png  # PWA manifest icons
```

### Usage

- **Default to `fp-icon.svg`** (dimensional, dark card). Use it for app icons, splash screens, anywhere a contained mark reads.
- **Use transparent marks** (`fp-mark-*.svg`) when overlaying on photography, hero images, or non-card surfaces.
- **Use lockups** when the brand needs to be named — site headers, pitch decks, footers.
- **Mono variants** for: faxes, embroidery, single-color print, watermarks. Don't use them in UI when color is available.

### Don't

- Don't recolor the dimensional mark. The amber gradient is fixed.
- Don't add effects (glow, drop-shadow) to the logo beyond what's baked in.
- Don't put the color FP on amber backgrounds. Use white/black mono instead.
- Don't stretch, rotate, or skew.
- Don't recreate the mark with text — always use the SVG.

### Clear space

Maintain at least **⅓ the width of the FP mark** as clear space on every side. Minimum sizes: **24px** in UI, **16px** for favicons.

### `<head>` snippet

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0b0c0f">
```

### `site.webmanifest` (canonical)

```json
{
  "name": "Foundry Planning",
  "short_name": "Foundry",
  "description": "Cash-flow planning, calibrated for advisors.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0c0f",
  "theme_color": "#0b0c0f",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

---

## 3. Color tokens — canonical

These are mirrored from `src/app/globals.css` (Tailwind v4 `@theme inline` block) and `src/brand/tokens.ts`. Keep them in sync.

### Tailwind / CSS

```css
@theme inline {
  /* ---------- Brand ---------- */
  --color-accent:        #f59e0b;   /* primary accent — CTA, mark, highlights */
  --color-accent-ink:    #fbbf24;   /* hover · accent text on dark surfaces  */
  --color-accent-deep:   #b45309;   /* pressed · darker tier                 */
  --color-accent-on:     #1a1205;   /* text/icons sitting on accent fills    */

  /* ---------- Surfaces ---------- */
  --color-paper:         #0b0c0f;   /* app background · canvas               */
  --color-card:          #151820;   /* elevated cards                         */
  --color-card-2:        #1b1f28;   /* nested surfaces · inputs               */
  --color-card-hover:    #1f2330;   /* hover state                            */

  /* ---------- Ink ---------- */
  --color-ink:           #f4f5f7;   /* primary text                           */
  --color-ink-2:         #c7cbd4;   /* secondary text                         */
  --color-ink-3:         #8b909c;   /* tertiary · captions                    */
  --color-ink-4:         #5a5f6b;   /* disabled · muted                       */

  /* ---------- Hairlines ---------- */
  --color-hair:          #252a34;   /* borders · dividers                     */
  --color-hair-2:        #303642;   /* stronger borders                       */

  /* ---------- Status ---------- */
  --color-good:          #34d399;   /* gains · success                        */
  --color-warn:          #fbbf24;   /* warnings                               */
  --color-crit:          #f87171;   /* losses · errors · destructive          */

  /* ---------- Category taxonomy ---------- */
  --color-cat-income:        #34d399;
  --color-cat-portfolio:     #60a5fa;
  --color-cat-life:          #a78bfa;
  --color-cat-tax:           #f59e0b;
  --color-cat-insurance:     #f472b6;
  --color-cat-transactions:  #22d3ee;

  /* Allocation aliases (used in portfolio charts) */
  --color-alloc-equities: var(--color-cat-income);
  --color-alloc-fi:       var(--color-cat-portfolio);
  --color-alloc-cash:     var(--color-cat-life);
  --color-alloc-re:       var(--color-cat-tax);
  --color-alloc-alt:      var(--color-cat-insurance);

  /* ---------- Radii ---------- */
  --radius-sm: 6px;
  --radius:    10px;

  /* ---------- Type ---------- */
  --font-sans: var(--font-inter);
  --font-mono: var(--font-jetbrains-mono);
}

:root {
  --pad-card:   24px;
  --pad-card-y: 22px;
  --gap-grid:   16px;
  --row-h:      36px;

  --background: var(--color-paper);
  --foreground: var(--color-ink);
}

body {
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-sans);
}

::selection { background: var(--color-accent); color: var(--color-accent-on); }
```

### TypeScript (`src/brand/tokens.ts`)

```ts
export const colors = {
  accent: "#f59e0b", accentInk: "#fbbf24", accentDeep: "#b45309", accentOn: "#1a1205",
  paper: "#0b0c0f", card: "#151820", card2: "#1b1f28", cardHover: "#1f2330",
  ink: "#f4f5f7", ink2: "#c7cbd4", ink3: "#8b909c", ink4: "#5a5f6b",
  hair: "#252a34", hair2: "#303642",
  good: "#34d399", warn: "#fbbf24", crit: "#f87171",
  cat: {
    income: "#34d399", portfolio: "#60a5fa", life: "#a78bfa",
    tax: "#f59e0b", insurance: "#f472b6", transactions: "#22d3ee",
  },
} as const;

export const radii   = { sm: 6, base: 10 } as const;
export const spacing = { padCard: 24, padCardY: 22, gapGrid: 16, rowH: 36 } as const;

export const fonts = {
  sans: '"Inter", system-ui, -apple-system, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

export const motion = {
  fast: 150, base: 200, slow: 320,
  ease:    "cubic-bezier(0.32, 0.72, 0, 1)",
  easeIn:  "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
} as const;

export const shadow = {
  sm: "0 1px 2px rgba(0,0,0,0.4)",
  md: "0 4px 12px rgba(0,0,0,0.4)",
  lg: "0 12px 32px rgba(0,0,0,0.5)",
  xl: "0 24px 64px rgba(0,0,0,0.55)",
} as const;
```

### Color rules

- **Primary action / brand:** `--color-accent` (#f59e0b). Buttons, links, focus rings, the FP mark, the period in "Foundry."
- **Hover on accent text:** `--color-accent-ink` (#fbbf24).
- **Pressed accent:** `--color-accent-deep` (#b45309).
- **Text/icons on amber fills:** `--color-accent-on` (#1a1205) — never pure black.
- **Status:** `--color-good` (gains/success), `--color-warn` (caution/warning), `--color-crit` (losses/errors/destructive).
- **Categories** are semantic — use `--color-cat-*` for income/portfolio/life/tax/insurance/transactions consistently across charts and tags.
- **Never** use pure black `#000` or pure white `#fff`. Use `--color-paper` and `--color-ink`.
- **Never** use more than two amber tiers in one component.

---

## 4. Typography

### Stacks

```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
```

### Google Fonts import

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### Type scale (canonical)

From `src/brand/tokens.ts` — **headings are 600, never 700/800**.

| Token | Size | Weight | Letter-spacing | Line-height | Use |
|---|---|---|---|---|---|
| `display` | 72px | 600 | -0.04em | 1.05 | Hero headlines |
| `h1` | 44px | 600 | -0.03em | 1.1 | Page titles |
| `h2` | 32px | 600 | -0.025em | 1.15 | Section titles |
| `h3` | 22px | 600 | -0.015em | 1.25 | Subsection / card headers |
| `bodyL` | 17px | 400 | -0.005em | 1.55 | Lede, intro paragraphs |
| `body` | 14px | 400 | 0 | 1.5 | Default body, table cells |
| `caption` | 11px | 500 | 0.08em | 1.4 | Labels, eyebrows. **UPPERCASE.** |

### Tabular numbers (for any financial figure)

```css
.tabular {
  font-family: var(--font-mono);
  font-feature-settings: "tnum", "cv11";
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
```

Use `.tabular` on every dollar amount, percentage, count, date, or aligned column. **No exceptions** — financial data must align vertically.

### Mono usage

JetBrains Mono is for **labels, eyebrows, code, tabular data** — never body. As a label, always uppercase + 0.08em tracked + weight 500:

```css
.eyebrow, .label, .sec-num {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent);  /* on dark — or --color-ink-3 for neutral */
}
```

### Section eyebrow pattern

```html
<div class="sec-num">02 · Clear space</div>
<h2 class="sec-title">Give the mark room</h2>
```

Always number sections `01 · `, `02 · ` with a mid-dot.

---

## 5. Spacing, radii, shadows, motion

### Spacing (canonical from `tokens.ts`)

The system uses **named spacing tokens**, not a generic 4px scale:

```css
--pad-card:   24px;   /* Card padding (X) */
--pad-card-y: 22px;   /* Card padding (Y) */
--gap-grid:   16px;   /* Grid gap between cards */
--row-h:      36px;   /* List/table row height */
```

For ad-hoc spacing, use Tailwind's default 4px-based scale (`p-2`, `gap-4`, etc.).

### Radii (canonical — only two)

```css
--radius-sm: 6px;     /* Small chips, tight controls */
--radius:    10px;    /* Default — cards, buttons, inputs */
```

**Don't use** `--radius-lg`, `2xl`, etc. The system is intentionally limited to two radii. Pills are an exception (`9999px` for status chips).

### Shadows

```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
--shadow-md: 0 4px 12px rgba(0,0,0,0.4);
--shadow-lg: 0 12px 32px rgba(0,0,0,0.5);
--shadow-xl: 0 24px 64px rgba(0,0,0,0.55);
```

Prefer **hairlines** (`1px solid var(--color-hair)`) over shadows. Use shadows for elevation in modals, popovers, and dropdowns only.

### Motion

```css
/* Durations */
--dur-fast: 150ms;    /* Hover, micro-interactions */
--dur-base: 200ms;    /* Default — most state changes */
--dur-slow: 320ms;    /* Layout shifts, panel slides */

/* Easings */
--ease:      cubic-bezier(0.32, 0.72, 0, 1);   /* Default — natural decel */
--ease-in:   cubic-bezier(0.4, 0, 1, 1);       /* Exiting elements */
--ease-out:  cubic-bezier(0, 0, 0.2, 1);       /* Entering elements */
```

Always pair a duration with an easing. Default to `var(--dur-base) var(--ease)` for state changes.

Respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0ms !important; transition-duration: 0ms !important; }
}
```

---

## 6. Components

### Buttons

```css
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: var(--radius);
  font-family: var(--font-sans); font-size: 14px; font-weight: 600;
  background: var(--color-accent); color: var(--color-accent-on);
  border: 1px solid var(--color-accent);
  transition: background var(--dur-fast) var(--ease), transform 100ms var(--ease);
}
.btn:hover  { background: var(--color-accent-ink); border-color: var(--color-accent-ink); }
.btn:active { background: var(--color-accent-deep); transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--color-accent-ink); outline-offset: 2px; }

.btn.ghost {
  background: transparent; color: var(--color-ink-2);
  border: 1px solid var(--color-hair-2);
}
.btn.ghost:hover {
  color: var(--color-ink); border-color: var(--color-ink-3);
  background: var(--color-card-hover);
}
```

### Cards

```css
.card {
  background: var(--color-card);
  border: 1px solid var(--color-hair);
  border-radius: var(--radius);
  padding: var(--pad-card-y) var(--pad-card);
}
.card-nested {
  background: var(--color-card-2);
  border: 1px solid var(--color-hair);
  border-radius: var(--radius-sm);
}
```

### Form inputs

```css
.input {
  background: var(--color-card-2);
  border: 1px solid var(--color-hair-2);
  border-radius: var(--radius);
  padding: 8px 12px;
  color: var(--color-ink);
  font-family: var(--font-sans); font-size: 14px;
  height: var(--row-h);
}
.input::placeholder { color: var(--color-ink-3); }
.input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(245,158,11,0.15);
}
```

### Eyebrow / status chip

```css
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px; font-weight: 500;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--color-accent);
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  border-radius: 9999px;
}
```

### Top bar

Sticky, blurred, hairline border:

```css
.topbar-wrap {
  position: sticky; top: 0; z-index: 50;
  background: rgba(11, 12, 15, 0.72);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--color-hair);
}
.topbar { display: flex; align-items: center; justify-content: space-between; height: 64px; }
```

### Editable scenario indicator

Used to mark inputs/cards that participate in the scenario model:

```css
.scenario-editable {
  border-left-width: 2px;
  border-left-color: #7a5b29;   /* deep amber, dimmer than --color-accent */
}
```

---

## 7. Data & charts

- **All numbers tabular.** Always wrap dollar/percent/count values in `.tabular`.
- **Category color mapping:** charts must use `--color-cat-*` consistently — income green, portfolio blue, life purple, tax amber, insurance pink, transactions cyan. Don't remap.
- **Status colors** (`--color-good`/`--color-warn`/`--color-crit`) are reserved for trend / gain-loss / health states. Don't use category colors for status.
- **Allocation pies/bars** use `--color-alloc-*` aliases (equities, fi, cash, re, alt).
- **Negative values** in `--color-crit`. Positive values in `--color-good`. Neutral/projected in `--color-ink-2`.

---

## 8. Voice & copy

- **Tone:** confident, precise, declarative. Short sentences. No exclamation marks. No emoji.
- **Capitalize:** "Foundry Planning" full name, "Foundry." short with the period as part of the wordmark, "FP" for the mark.
- **Avoid:** marketing fluff ("revolutionary", "seamless", "powerful"), hype, em-dashes used as ellipses, finance-bro language ("alpha", "synergy", "10x").
- **Prefer:** verbs, nouns, numbers. Industrial vocabulary ("ship", "build", "calibrate", "tighten") and advisor vocabulary ("model", "scenario", "projection", "calibration") over soft tech vocabulary.
- **Microcopy patterns:**
  - Section labels: numbered (`01 · Logo`, `02 · Clear space`).
  - CTA verbs: "Run scenario", "Open plan", "Calibrate", "Add line item".
  - Empty states: state the fact, then the action. *"No scenarios yet. Build one →"*

---

## 9. Imagery & icons

- **Photography:** if used, prefer industrial / architectural / instrumentation subjects. Dim, warm grading. No stock-photo people in offices.
- **Illustration:** geometric, line-based, two-tone (amber + neutral). No 3D blobs, no rainbow gradients.
- **Icons:** use [Lucide](https://lucide.dev/) (preferred — pairs with Inter) at stroke width **1.5–1.75**. Always `currentColor`. Size to match line-height of adjacent text (typically `16px` or `20px`).

---

## 10. Accessibility floor

- Body text contrast ≥ **4.5:1** against bg.
- `--color-ink-4` (#5a5f6b) is **disabled-only** — never use for active text, fails AA.
- Interactive elements have visible `:focus-visible` (amber ring, 2px, 2px offset).
- Tap targets ≥ **44×44px** on mobile.
- Don't rely on color alone — pair gain/loss colors with arrow icons or sign prefixes.
- Honor `prefers-reduced-motion` (see Motion section).

---

## 11. Quick recipes

### Hero block (dark)

```html
<section class="hero">
  <div class="eyebrow"><span class="dot"></span>Brand kit · v1.0</div>
  <h1 class="display">Build the system. <span class="ink">Ship the spec.</span></h1>
  <p class="lede">Foundry Planning is the planning surface for advisors who calibrate, not guess.</p>
  <div class="cta-row">
    <a class="btn">Open plan</a>
    <a class="btn ghost">Read the docs</a>
  </div>
</section>
```

```css
.hero h1 .ink { color: var(--color-accent); }
.hero .lede   { color: var(--color-ink-2); font-size: 17px; line-height: 1.55; max-width: 540px; }
```

### Stat card

```html
<div class="card">
  <div class="eyebrow">Net worth</div>
  <div class="stat-num tabular">$2,481,300</div>
  <div class="stat-delta tabular">+12.4% YoY</div>
</div>
```

```css
.stat-num   { font-size: 44px; font-weight: 600; letter-spacing: -0.03em; margin-top: 12px; }
.stat-delta { font-size: 12px; color: var(--color-good); letter-spacing: 0.04em; margin-top: 4px; }
```

### Numbered section header

```html
<header class="sec-head">
  <div>
    <div class="sec-num">01 · Plan</div>
    <h2 class="sec-title">Calibrate the model</h2>
  </div>
  <p class="sec-blurb">Three inputs. One projection.</p>
</header>
```

---

## 12. Files in this brand kit

| Path | Purpose |
|---|---|
| `Brand Kit.html` | Dark-theme brand kit page (canonical reference) |
| `Brand Kit Light.html` | Cream/light-theme version |
| `assets/` | All dark logo SVGs + PNG exports |
| `assets/light/` | Light-bg variants of everything in `assets/` |
| `download/Foundry-Brand-Kit-Standalone.html` | Single-file offline-able kit |
| `design.md` | This file — read before designing |

When in doubt, open `Brand Kit.html` — every component, color, and asset is rendered there with its file path.

---

## 13. Sync checklist (for when tokens change)

When you update any of the canonical sources, update **all three**:

1. `src/app/globals.css` — Tailwind `@theme inline` block
2. `src/brand/tokens.ts` — TypeScript exports
3. `design.md` — this file (sections 3, 4, 5)

Plus: if logos/icons change, regenerate `assets/icons/*.png` from the master SVG and rebuild `download/Foundry-Brand-Kit-Standalone.html`.
