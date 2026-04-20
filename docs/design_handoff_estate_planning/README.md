# Handoff: Estate Planning — Flowchart Canvas + Projection

## Overview

This is the Estate Planning report for **Foundry Planning**, a wealth-management platform. It lets an advisor **build an estate plan visually**: drag assets between a client's in-estate holdings and out-of-estate trusts, then scrub a year slider to see how that plan compounds over time vs. doing nothing.

The core idea: an estate plan isn't a static snapshot — it's a *trajectory*. Money gifted into an irrevocable trust today grows **outside** the taxable estate for decades. The design has to make that time-value-of-planning tangible.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing the intended look and behavior, not production code to copy directly. Your task is to recreate these HTML designs in the target codebase's existing environment (React, Vue, etc.) using its established component library, design tokens, and patterns.

If no environment exists yet, pick the most appropriate framework for the project (React + TypeScript is a reasonable default for this kind of data-dense financial tool) and implement from there.

The chart (`<svg>` drawn imperatively) should be rebuilt using whatever charting library the app already uses (Recharts, Visx, D3, etc.) rather than hand-drawn SVG.

## Fidelity

**High-fidelity.** Colors, spacing, typography, and interactions are specified. Match them closely. The palette is deliberately muted — no bright reds, no saturated data-viz rainbows — because this is a serious financial tool used in client meetings.

The one exception: the simple expand/collapse and scrubber wiring in the prototype is demonstration-quality JS. Rebuild interactions using the app's real state management, real asset data, and real backend calls.

## Files in This Bundle

- `Estate Planning v2.html` — **primary reference**. Contains the Flowchart tab (canvas + projection panel) in final form.
- `Estate Planning v1 (other states).html` — earlier version that still contains **other states** not in v2: mid-drag preview, Create Trust side-over, empty state, Impact & Beneficiaries tab with Sankey diagram. Use these as references for states that v2 doesn't illustrate.

---

## Screens / Views

The report has **four tabs** (only Flowchart is fully designed in v2):

1. **Flowchart** (v2, primary) — visual estate builder with projection panel
2. Impact & Beneficiaries (v1 reference)
3. Documents (not designed)
4. Assumptions (not designed)

### Screen 1 · Flowchart Tab

The tab has two major sections stacked vertically:

#### Section A · Canvas (three-column grid)

A `1440px`-wide frame divided into three columns:

| Column       | Width  | Purpose                                                    |
| ------------ | ------ | ---------------------------------------------------------- |
| In Estate    | `320px`| Collapsible client cards (Tom, Linda). Assets drag from here. |
| Death-Sequence Spine | flex 1 | Vertical timeline: Today → 1st death → combined → 2nd death → heirs |
| Out of Estate | `360px` | Collapsible trust cards. Assets drop here.                |

**Column headers** — `padding: 16px 20px 12px`, bottom-bordered `1px solid var(--line-soft)`. Contain an uppercase label (10.5px, letter-spacing `0.14em`, color `--fg-2`) and a total (JetBrains Mono, color `--fg-1`).

##### Client card (left column)

Collapsed row (46px tall including padding):
- 36×36 circle avatar with initial, background color varies by person (`#3E5568` for Tom, `#4A4256` for Linda)
- Name (14px, weight 600, `--fg-0`)
- Meta line (11px, `--fg-3`) — e.g. "Age 58 · Grantor of 2 trusts"
- Right-aligned value (15px JetBrains Mono, weight 600) + sub ("solo + ½ joint", 10.5px)
- Caret `▸` that rotates 90° when open

Expanded body:
- Inset background (`--bg-inset: #0D0F14`)
- Section labels for **"Owned outright"** and **"Jointly held"** — uppercase 9.5px with a horizontal divider line
- Asset rows (32px tall): category dot (6×6 square), asset name, tax-treatment tag (`DEF`/`TAX`/`FREE`/`DB`), value
- Outright rows are **draggable** (`cursor: grab`, hover brightens)
- Joint rows are **locked** (marked `⇋`, `opacity: 0.72`, non-draggable) — require an allocation step before they can be moved
- Footer with count + total

##### Death-sequence spine (center column)

Vertical flow, centered, `70%` width for the middle tax/inheritance bands. Reads top-down:

1. **Timeline tick** — small dot + uppercase label + thin rule + year, e.g. "TODAY · 2026"
2. **Pair row** — two large equal blocks side-by-side: *Tom's Net Worth $10.62M*, *Linda's Net Worth $9.94M*
   - Block: `padding: 18px 20px`, background `var(--spouse) #3E5568`, white-ish text, value 24px JetBrains Mono
3. **Arrow down** (14×22 SVG chevron, `--fg-3`)
4. **Stage bands** — two stacked horizontal bars:
   - `band.tax` → background `var(--tax) #6B3D2E`, e.g. "Taxes & Expenses · $0"
   - `band.inherit` → background `var(--inherit) #355267`, e.g. "Inheritance to Linda · $10,620,000"
5. **Combined block** — single wide block, `var(--spouse)`, value 28px
6. Timeline tick — "SECOND DEATH · LINDA · 2054"
7. Stage bands again:
   - `band.tax` — "−$4,180,000"
   - `band.heirs` — background `var(--heirs) #5D6A45`, "To heirs (gross) · $16,380,000"
8. **Beneficiary strip** — 4-column grid of small cards (Tom Jr., Sarah, Stanford, SLAT remainder) each with name, relationship, value in teal (`--accent-hi`), and percentage
9. **Totals row** — two-column grid:
   - `total-card.tax` — red circle icon + "Total Taxes & Expenses" + value in `--neg`
   - `total-card.heirs` — green circle icon + "Total to Heirs" + value in `--accent-hi`

##### Trust card (right column)

Collapsed row (very similar structure to client card but different colors):
- 8×8 square icon, colored by trust type
- Name (13px, weight 600)
- Meta: **tag pill** (9.5px uppercase) + grantor info
  - `tag.irrev` — warm gold on `--warn-tint`
  - `tag.slat` — teal on `--accent-tint`
  - `tag.rev` — soft blue on blue tint
- Value + asset count
- Caret

Expanded body:
- `--bg-inset` background
- Sub-row: Trustee, Remainder (11px, `--fg-2`)
- Held asset rows (not draggable while inside the trust — but there's a remove `×`)
- Dashed drop-zone: "Drop assets from Tom's card to fund"
- Footer: "Uses exemption · $2.40M / $13.99M" — exemption shown in `--warn` color

Below the trust list:
- **"+ Create new trust"** dashed affordance card
- **Out-of-estate summary** card: 4 rows (Held outside / Exemption used / Remaining / **Tax saved** emphasized)

#### Section B · Projection & Comparison

Sits directly below the canvas. Bordered card, `--bg-0` background.

##### Projection header

Bar with title on the left (`02 · Projection & Comparison` + teal "LIVE" kicker pill) and three assumption chips on the right (Growth 6.0%/yr, Inflation 2.5%, Exemption sunset 2026) + "Edit assumptions" ghost button.

##### Year scrubber

Full-width interactive slider. Three zones stacked:

1. **Header row**:
   - Big year number (32px JetBrains Mono) with "+N years from now" + event pill ("Second death · Linda" in red-tinted pill)
   - Right side: preset buttons (`Today`, `+10y`, `1st death`, `2nd death`, `+40y`). Active button has teal background.
2. **Track**:
   - Horizontal rail (2px, `--line`) with teal `--accent` fill from `0%` to current position
   - Event pins at key years (Today/2026, 1st death/2048, 2nd death/2054) — 10×10 circles colored by event type
   - Event labels above the track showing event name + year
   - Thumb: 18×18 teal circle with dark inner border + teal glow ring
   - Invisible `<input type="range" min="2026" max="2066">` overlays the track for pointer/keyboard control
3. **Tick row**: `2026 · 2036 · 2046 · 2056 · 2066`

Background: subtle radial glow at bottom-center using `--accent-tint`.

##### Three-column comparison

Grid with 1px gap (line color shows through). All three cells have a label row, a headline, a big number, and a 4-row breakdown.

| Column            | Background         | Headline color   | Purpose                                   |
| ----------------- | ------------------ | ---------------- | ----------------------------------------- |
| Without plan      | `--bg-0`           | `--fg-0`         | "do nothing" baseline                     |
| With current plan | `--bg-1`           | `--accent-hi`    | ILIT + SLAT applied                       |
| Plan impact       | subtle teal gradient | `--accent-hi`  | Delta: tax saved, growth captured         |

Each breakdown row:
- Small color swatch (8×8 matching the spine color it refers to) + label on the left
- JetBrains Mono value on the right, colored by sentiment (`neg`, `pos`, or neutral)

##### Growth chart

- 1200×220 `viewBox` SVG (scales to full width)
- X-axis: `2026 → 2066`, ticks every 10 years
- Y-axis: 4 horizontal grid lines, labels on the left in `$NM` format (JetBrains Mono, 10px, `--fg-3`)
- **Without-plan series**: `--spouse #3E5568` stroke, matching area gradient at 25% opacity
- **With-plan series**: `--accent #3FB8AF` stroke (2.5px), area gradient at 35% opacity
- Dashed vertical death lines at 2048 (rust) and 2054 (red) with labels "TOM" / "LINDA" at top
- Current-year vertical line (teal) with two circles showing both series values, and a label above the plan dot with the dollar value

##### Strategy impact cards

3-column grid, `--bg-1` background:
- **ILIT · $5M policy** — `+$5.00M` (green) — "Death benefit paid **outside the estate**"
- **SLAT · $2.4M gift in 2026** — `+$N.NNM` (green, live) — "Compounded at 6% for N years"
- **If you wait 10 years** — `−$N.NNM` (red, live) — "Cost of procrastination"

---

## Interactions & Behavior

### Canvas
- **Client card click** → toggle `.open` class; body expands/collapses with 180ms caret rotation
- **Trust card click** → same expand/collapse behavior
- **Drag outright asset** → only draggable from an *expanded* client card; joint assets never draggable
- **Drop on trust card** → on valid target: border lights up `--accent`, inset glow `--accent-glow`. On drop: move asset into trust, recompute all totals.
- **"+ Create new trust"** → opens the Create Trust side-over (v1 reference)

### Projection panel
- **Range slider** → `input` event recomputes every value across the panel (comparison columns, strategy cards, chart)
- **Preset buttons** → snap to that year, mark button active
- **All numbers animate?** Not currently; the prototype updates instantly. In production, consider 200ms tween on big numbers only.

### Projection model (pseudo — see `<script>` in v2 HTML for reference impl)

```
inEstateToday = sum of all in-estate assets (e.g. $20.56M)
ooeToday = sum of all trust assets (e.g. $7.40M, of which ILIT $5M is face value)

growth = 6% compounded annually
death2Year = scenario second-death year (default 2054)
taxRate = 52% (federal 40% + CT ~12% effective over exemption)
exemptionCombined = 2 × $13.99M (portability assumed)

// WITHOUT PLAN: SLAT gift never happened, everything grows in-estate
nopGross = (inEstateToday + slatToday) × 1.06^years
nopTax = max(0, nopGross − exemptionCombined) × taxRate   // only at death2
nopNet = nopGross − nopTax − admin

// WITH PLAN
planInEstGross = (inEstateToday − slatToday) × 1.06^years
planInEstTax = (planInEstGross − exemptionCombined + exemptionUsedBySlat) × taxRate
slatGrown = slatToday × 1.06^years     // tax-free!
ilitValue = faceValue if year ≥ death2 else small cash-value estimate
planNet = (planInEstGross − planInEstTax − admin) + slatGrown + ilitValue

deltaHeirs = planNet − nopNet
```

Pre-death years (year < death2): show tax rows as "$0 (pre-death)". The divergence between the two series is the *lesson* — before death they're similar, after death they split sharply.

---

## State Management

Global state this view needs:
- `scenario` — currently `{id, name, ...}` with clients, assets, trusts, assumptions
- `scenario.clients[]` — `{id, name, age, assets: [...], jointAssets: [...]}`
- `scenario.trusts[]` — `{id, name, type: 'ILIT'|'SLAT'|'Revocable'|..., grantor, trustee, remainder, assets: [...]}`
- `scenario.assumptions` — `{growthRate, inflationRate, death1Year, death2Year, exemptionPerPerson, ...}`
- `ui.expandedClientIds: Set` / `ui.expandedTrustIds: Set`
- `ui.projectionYear: number` (default `death2Year`)
- `ui.draggingAssetId: string | null`

Recompute `project(year)` whenever scenario OR `projectionYear` changes. Memoize by `(scenarioHash, year)`.

---

## Design Tokens

### Colors

| Token | Hex | Use |
|-------|-----|-----|
| `--bg-0` | `#0A0C10` | Page, canvas frame |
| `--bg-1` | `#12151C` | Card surfaces |
| `--bg-2` | `#1A1E27` | Nested surface / inputs |
| `--bg-3` | `#232834` | Tag background, hover |
| `--bg-inset` | `#0D0F14` | Expanded card body |
| `--line-soft` | `#21262F` | Divider lines |
| `--line` | `#2A2F3C` | Default borders |
| `--line-strong` | `#3A414F` | Hover borders |
| `--fg-0` | `#E6E9EF` | Primary text |
| `--fg-1` | `#B7BECC` | Secondary text |
| `--fg-2` | `#8A92A3` | Tertiary |
| `--fg-3` | `#5C6478` | Muted / captions |
| `--fg-4` | `#3A414F` | Dim / placeholders |
| `--accent` | `#3FB8AF` | Primary interactive (muted teal) |
| `--accent-hi` | `#7DD3CC` | Positive values, hover |
| `--accent-deep` | `#2A8A84` | Gradient end |
| `--accent-tint` | `rgba(63,184,175,0.10)` | Fill tints |
| `--accent-line` | `rgba(63,184,175,0.35)` | Interactive borders |
| `--accent-glow` | `rgba(63,184,175,0.18)` | Drop-target shadow |
| `--neg` | `#E06B6B` | Taxes, negative delta |
| `--pos` | `#7DB58A` | Secondary positive |
| `--warn` | `#C9985A` | Exemption usage |

**Spine palette (reference flowchart colors):**

| Token | Hex | Use |
|-------|-----|-----|
| `--spouse` | `#3E5568` | Estate-value blocks |
| `--tax` | `#6B3D2E` | Tax/expense band |
| `--inherit` | `#355267` | Inheritance band |
| `--heirs` | `#5D6A45` | To-heirs band |
| `--trust-card` | `#22262F` | Trust card body |

### Typography

- UI: **Inter** — weights 400, 500, 600, 700
- Tabular numbers: **JetBrains Mono** — weights 400, 500, 600
  - All currency and year values use JetBrains Mono with `font-variant-numeric: tabular-nums` and `letter-spacing: -0.01em`
- Base body: `13px / 1.45`
- Titles: `h1` 22px weight 600, section heads 13px weight 600
- Big-number display: 30–32px weight 600 letter-spacing `-0.02em`
- Uppercase labels: 10.5px letter-spacing `0.14em` color `--fg-2` or `--fg-3`

### Spacing / Radii / Shadows

- Card radius: `8px` (inner rows), `10px` (outer frames), `6px` (small blocks, chart tiles)
- Standard padding: cards `14–22px`, nested rows `7–10px`
- Shadows are **minimal** — rely on 1px borders and surface-color stepping for depth, not drop shadows. The only shadow is the scrubber thumb glow.

---

## Assets

No external assets — icons are inline SVG strokes (class `.i`, 14×14, `stroke-width: 1.5`). The "F" brand mark is a CSS gradient square. Replace with the app's real icon and brand systems.

---

## Implementation Notes

1. **The spine numbers are currently static in v2 HTML.** They represent the *death-year* snapshot. When the projection slider moves, only the projection panel below updates. That's intentional — the spine is "the plan's endgame", the projection is "when in time are you looking". If the product decides the spine should also reflect the slider year, you'll need to decide what "$0 taxes at first death" means in, say, 2036.

2. **Drag-and-drop is stubbed.** v2 has `draggable="true"` on outright asset rows and styled hover states, but no actual drop handlers. Wire up using `@dnd-kit/core` or `react-dnd` depending on your stack.

3. **Chart rendering.** The prototype uses hand-drawn SVG. Swap to Recharts/Visx. Preserve: area gradients, two dashed vertical death-year guides, current-year marker line with dual dots and a label on the plan dot.

4. **Presets and custom assumptions.** The "Edit assumptions" button is cosmetic — needs to open a modal/panel for editing growth rate, inflation, death years, etc. Probably lives outside this handoff.

5. **Accessibility.** Scrubber: the visible thumb is decorative — the real control is an invisible `<input type="range">` overlaid on the track (keyboard + screen-reader friendly). Preserve this pattern. Expand/collapse rows should use `<button>` elements with `aria-expanded`.

6. **Currency formatting.** `fmtM()` in the prototype picks between `$N.NNM` and `$NNK`. Standardize on your app's money formatter; the thresholds are: `≥ $1M → X.XXM`, `≥ $1K → XK`, else `$N`.
