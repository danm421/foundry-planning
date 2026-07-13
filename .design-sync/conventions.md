# Building with Foundry Planning components

Foundry Planning is financial-planning software for advisors. Surfaces are
**dark-first, quiet, and numbers-forward**: the chrome stays out of the way and
the figures carry the weight.

## Setup & wrapping

- Root every screen in `bg-paper text-ink font-sans`. Tokens are pure CSS —
  no theme provider is needed. Dark is the default; opt into light by setting
  `data-theme="light"` on the document root (never hardcode either theme's hex).
- Toasts: wrap the app once in `ToastProvider`, then call
  `useToast().showToast({ message, undo? })` from any child.
- `BrandHeader` must sit inside `SidebarProvider`.
- Dialogs are controlled: `DialogShell` takes `open` / `onOpenChange`, a
  `title`, and `primaryAction={{ label, onClick }}` (plus optional `tabs`,
  `secondaryAction`, `destructiveAction`).

## Styling idiom: Tailwind token classes, never raw hex

Color vocabulary (as `bg-` / `text-` / `border-`): `paper` (canvas), `card` /
`card-2` / `card-hover` (surfaces, inputs), `ink` / `ink-2` / `ink-3` / `ink-4`
(text hierarchy: primary → disabled), `hair` / `hair-2` (borders), `accent` +
`accent-ink` / `accent-deep` / `accent-on` / `accent-wash` (verdigris — action
ONLY), `secondary` (indigo: links, focus, AI), `good` / `warn` / `crit`
(status), `cat-income` / `cat-portfolio` / `cat-life` / `cat-tax` /
`cat-insurance` / `cat-transactions` (category data), and chart series
`var(--data-red|blue|green|yellow|grey|orange|purple|teal|pink)`.

Kit classes (use before ad-hoc utilities): `btn-primary` (verdigris CTA),
`btn-ghost` (hairline button), `card` (hairline surface), `chip` /
`chip-accent` (mono uppercase pill), `tabular` (B612 Mono numerals), `dot`
(verdigris trailing period on a headline — max one per section).

Hard rules the brand enforces:
- **Every number is mono**: render money/percents with the `MoneyText`
  component (`value`, `format="currency|pct|int|accounting"`, `size="body|kpi"`)
  or put the `tabular` class on the element. Numerals in Inter are a brand
  violation.
- **The verdigris accent means action** — CTA fills, status pips, the trailing
  dot. Never color a KPI or data value with it; data uses `ink` or the
  `--data-*` palette.
- **Hairlines, not shadows**, for hierarchy. Shadows only on true overlays.
- Captions/eyebrows: 11px uppercase with `tracking-[0.08em] text-ink-3`.
- Voice: plain and specific, no exclamation points; "$4.21M", never "~$4M".

## Where the truth lives

Read `styles.css` (its import closure carries the full token set, the kit
classes, and the `@font-face` rules for Inter + B612 Mono) before inventing
styles, and each component's `.d.ts` + `.prompt.md` for its real API. The
`guidelines/` doc covers the full brand contract (voice, type scale, charts).

## Idiomatic example

```tsx
import { Card, CardBody, MoneyText } from "foundry-planning";

<div className="bg-paper text-ink font-sans p-10">
  <Card style={{ width: 280 }}>
    <CardBody>
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Net worth</div>
      <div className="mt-1"><MoneyText value={4213850} size="kpi" /></div>
      <div className="mt-1 text-[12px] text-good tabular">+$182,400 YTD</div>
    </CardBody>
  </Card>
</div>
```
