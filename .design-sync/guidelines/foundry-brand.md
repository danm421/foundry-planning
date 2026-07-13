# Foundry brand & UI contract

Foundry Planning is cash-flow-based financial planning software for advisors.
The identity: **direct, specific, confident, quiet.** Numbers carry the weight;
the chrome stays out of their way. Prefer fewer elements, restraint, and more
breathing room than your default.

## The two brand layers (decide first)

- **Product chrome** (app shell, settings, nav, dialogs, marketing): full
  Foundry brand — verdigris accent, near-black canvas, Inter + B612 Mono.
- **Client-facing report or PDF**: the *advisor's* document, not Foundry's.
  Light/print theme, the firm's own primary color and logo. Do NOT impose
  Foundry verdigris on client-facing report surfaces.

## Voice & copy

- Plain over clever. "Build a plan you can stand behind" beats "Unlock financial freedom."
- Numbers, not adjectives. "1,000 paths · sub-second" beats "blazing fast."
- Never round to vagueness: "$4.21M", not "~$4M".
- No exclamation points. Banned words: leverage, synergy, unlock, empower,
  unleash, "we believe".
- Voice check: would you say this aloud to a 70-year-old client across the
  table? If not, rewrite.
- How-it-works explanations go in a `FieldTooltip`, never as always-visible
  paragraphs under an input. Every advisor screen must be presentable to a
  client as-is — keep the canvas quiet.

## Color

Use token classes / `var(--color-*)` — never raw hex.

| Token (`bg-` / `text-` / `border-`) | Role |
|---|---|
| `paper` | App background / canvas |
| `card` / `card-2` / `card-hover` | Elevated cards / nested surfaces, inputs / hover |
| `ink` / `ink-2` / `ink-3` / `ink-4` | Primary / secondary / tertiary / disabled text |
| `hair` / `hair-2` | Borders and dividers / stronger borders |
| `accent` (+ `accent-ink`, `accent-deep`, `accent-on`, `accent-wash`) | **Brand voice — action only**: CTA fills, the mark, the trailing dot, status pips |
| `secondary` (+ `secondary-ink`, `secondary-on`, `secondary-wash`) | Links, secondary CTAs, AI treatment, focus/selection |
| `good` / `warn` / `crit` | Gains · success / warnings / losses · errors |
| `cat-income`, `cat-portfolio`, `cat-life`, `cat-tax`, `cat-insurance`, `cat-transactions` | Category taxonomy for cash-flow data |

**The accent (verdigris) is reserved.** It appears ONLY in primary CTA fills,
the mark, a headline's trailing dot, and small status pips. Never color a data
value, KPI, or big number with the accent to make it "pop" — color data with
`ink` or the data palette; verdigris means *action*.

**Charts** use the Deep Jewel data palette — `var(--data-red)`, `-blue`,
`-green`, `-yellow`, `-grey`, `-orange`, `-purple`, `-teal`, `-pink`. Lead
with the six anchors in order, add the three fills as series grow. Gridlines
use `hair`. No 3D, gradients, or drop shadows in chart fills. Both themes are
carried by the tokens — never hardcode either theme's hex.

## Type

Two families, two jobs. **Inter** for everything that isn't a number
(`font-sans`). **B612 Mono** for every number, via the `.tabular` utility.

- Every dollar, percent, date, and ID is mono: apply `.tabular` (mono +
  tabular-nums). Currency rendered in Inter is a brand violation.
- B612 Mono's zero is a plain ring — never substitute a mono with a dotted or
  slashed zero, and never enable the `zero`/`cv11` OpenType features.
- Scale (size/line, weight 600 for headings): display 72/1.05 · h1 44/1.1 ·
  h2 32/1.15 · h3 22/1.25 · bodyL 17/1.55 · body 14/1.5 · caption 11/1.4
  (uppercase, 0.08em tracking).
- Signature move: a display headline ending in a verdigris period —
  `<h1>Plans that hold up<span className="dot">.</span></h1>`. Max one per
  visible section.

## Layout & components

- Kit utility classes before ad-hoc styles: `.btn-primary` (verdigris CTA),
  `.btn-ghost` (hairline border, ink text), `.card` (hairline border, ~12px
  radius), `.chip` / `.chip-accent` (mono uppercase pill), `.tabular`
  (mono numerics), `.dot` (verdigris trailing period).
- **Hairlines, not shadows.** Borders communicate hierarchy; shadows are
  reserved for true elevation (dialogs).
- Generous canvases: page padding 40–56px. Density tiers: dense (tables and
  sidebars, 12–13px), standard (most UI, 14–15px), spacious (hero, 22px+).
- Icons: Lucide, `strokeWidth={1.5}`, `currentColor`, outline-only, accent
  for active state.
- Default a page to `bg-paper text-ink font-sans`.

## Common mistakes

| Mistake | Fix |
|---|---|
| Inline paragraph explaining how a field works | Move it into `FieldTooltip` |
| Big number in Inter | Numbers are mono — apply `.tabular` |
| Coloring a KPI with the accent to make it pop | Accent = action only; use `ink` or the data palette |
| Hardcoding theme hex | Use token classes / `var(--color-*)` |
| Shadows for hierarchy | Hairline borders (`hair`) |
| A serif, or a second mono | Single sans (Inter) + single mono (B612 Mono) only |
| Foundry verdigris on a client report/PDF | Firm primary color + light print theme |
