# design-sync notes — foundry-planning

Repo-specific quirks for future syncs. This is an APP repo (no packaged
component library): the design system = Tailwind v4 tokens in
`src/app/globals.css` + a curated subset of `src/components/`.

## Source shape & entry

- No Storybook anywhere (user-confirmed 2026-07-13). Shape: `package`.
- No dist/: `cfg.entry` points at the curated barrel `.design-sync/ds-entry.tsx`
  (this file IS the DS public surface — keep it in sync with `componentSrcMap`).
  Every card-worthy component is pinned in `componentSrcMap`; barrel-only
  exports (CardHeader/CardBody/CardFooter, useToast, SidebarProvider) ride in
  the bundle without their own cards.
- `tsconfig.json` wired via `cfg.tsconfig` so `@/*` aliases resolve.
- Component groups come from `.design-sync/docs/<slug>.md` frontmatter stubs
  (`category:`) — docsDir discovery binds them; the stubs are category-only so
  `.prompt.md` synthesis still runs.

## CSS pipeline (the subtle part)

- `cfg.buildCmd` compiles `.design-sync/tailwind-entry.css` (which
  `@import`s the app's `globals.css` and adds `@source "./previews"`) with the
  Tailwind v4 CLI staged in `.ds-sync/node_modules`, then appends
  `.design-sync/tokens.css`.
- Tailwind v4 auto-detection NEVER scans dot-directories, so authored previews
  in `.design-sync/previews/` need that explicit `@source`. It DOES work —
  when verifying with grep remember compiled selectors escape brackets:
  `grep -F 'h-\[620px\]'`, not `grep 'h-[620px]'` (a wrong grep here cost an
  hour of false "it doesn't work").
- `preview-rebuild.mjs` does NOT recompile the CSS. Mid-wave, subagents must
  use inline styles for any class not already in the compiled CSS; the next
  orchestrator buildCmd+package-build picks new preview classes up.
- `.design-sync/tokens.css` defines `--font-inter`/`--font-b612` (injected by
  next/font at runtime in the real app) plus timeline-report aliases
  `--font-display`/`--font-body`. Without it text falls back to system fonts.

## Fonts

- Inter (variable 400–700) + B612 Mono (400/700), latin subsets, downloaded
  from Google Fonts (both OFL) into `.design-sync/fonts/` with a hand-written
  `fonts.css`; wired via `cfg.extraFonts`. Re-fetch script pattern: scratchpad
  `fetch-fonts.mjs` (CSS2 API with a Chrome UA, keep only `/* latin */` blocks,
  rewrite url() to local files).

## Guidelines gotcha (IMPORTANT)

- The DEFAULT `guidelinesGlob` includes `docs/*.md` — in this repo that means
  SECURITY_AUDIT.md, SOC2 readiness, pricing runbooks. `cfg.guidelinesGlob` is
  pinned to `.design-sync/guidelines/*.md` (a distilled brand doc). Never let
  the default glob back in.

## Rendering & previews

- Preview page body is WHITE; the app is dark-first (`:root` = dark tokens).
  Every preview cell wraps in `bg-paper text-ink font-sans p-6` — floor cards
  for unauthored components render near-invisible (white-on-white) by
  construction here, which is why Card/MoneyText tripped [RENDER_BLANK]
  pre-authoring.
- Fixed-position components (DialogShell and its wrappers, toast stack) use
  the Frame trick: a `transform: translateZ(0)` container becomes the
  containing block for `position: fixed`, so the overlay lays out inside the
  cell. See `.design-sync/previews/DialogShell.tsx`.
- Overlay overrides in config: DialogShell/ConfirmDeleteDialog/ToastProvider/
  FieldHintPopover render cardMode single with explicit viewports.
- BrandHeader needs `SidebarProvider` (barrel-exported for this purpose).
- Render check runs via the user's installed Google Chrome:
  `DS_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
  (no playwright chromium download; the `playwright` lib is installed in
  `.ds-sync` with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).

## Excluded / floor-only components

- **BackButton** — EXCLUDED from the synced set (removed from barrel +
  `componentSrcMap`). It's router-coupled chrome: `useBackNav()` throws without
  `BackNavProvider`, which itself needs Next's `usePathname`/`useRouter`
  context, and even mocked, BackButton renders `null` until the sessionStorage
  nav trail has history. Nothing a preview can compose. Don't re-add it without
  a way to render it.

## Known render warns

- B612 Mono renders visible letter-spacing after commas in grouped numbers
  (`$612,400` shows as `$612, 400`, `4.0%` as `4. 0%`). This is genuine
  app-wide font behavior, NOT a preview defect — do not "fix" it in previews.
- Two reveal-on-interaction components (FieldTooltip, FieldHintPopover) can
  only be captured in their resting `?`-badge state — no prop forces them open,
  and composition-only rules forbid reimplementing. Graded on the resting
  composition by design.
- HelpTip HAS a forceable open state: its preview clicks the real component's
  own button on mount (`querySelector("button").click()` in an effect) — that
  drives the real reveal path, not a fake. Reusable pattern for click-toggled
  components.
- LoadingLabel is `sr-only` by design (role=status, aria-live=polite) — no
  visual output. Its card pairs the real component with the Skeleton bars it's
  used alongside plus a caption documenting the hidden text; NOT a faked
  visible label.

## Re-sync risks

- The compiled CSS ships everything the WHOLE app uses (~250KB) — fine, but
  it moves whenever any app feature adds classes; expect bundle/styling churn
  on most re-syncs even when scoped components didn't change.
- Fonts were downloaded 2026-07-13; Google may revise the files. The woff2s
  are committed, so re-syncs are stable — only re-fetch deliberately.
- `--font-display`/`--font-body` aliases assume the timeline report keeps
  using Inter-compatible faces; if that feature's fonts change, update
  `.design-sync/tokens.css`.
- The curated barrel + componentSrcMap must move together when scope grows:
  add the export AND the pin AND (for grouping) a docs stub.
- Chrome is the render browser — a major Chrome auto-update could shift
  screenshot rendering slightly; grades follow sources, so this only matters
  for eyeball comparisons.
