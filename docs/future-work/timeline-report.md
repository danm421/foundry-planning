# Future Work — Timeline Report (shipped 2026-04-19)

- **PDF export.** Why deferred: v1 scope is on-screen only. Semantic HTML + `page-break-inside: avoid` on cards + a print hook that hides the sticky mini-map gets us 80% there.
- **User-configurable portfolio milestone thresholds.** Why deferred: no settings UI yet. v1 ships baked-in defaults `[1M, 2M, 5M, 10M]` in `src/lib/timeline/detectors/portfolio.ts`.
- **Timeline year-range slider.** Why deferred: mini-map + category filters cover the 80% case.
- **URL state persistence** (filters, active sparkline, expanded card). Why deferred: keeps v1 simple.
- **IRMAA-triggering year detection.** Why deferred: needs a tax-data signal we may not surface today.
- **Transfer recurring-bands visualization.** Why deferred: v1 suppresses recurring small transfers.
- **Timeline animation polish pass.** Why deferred: v1 ships functional animations only.
- **Hover dot → highlight card** on the sparkline. Why deferred: v1 ships card → dot only.
- **Timeline pension detection.** Why deferred: engine `Income.type` union has no `"pension"` — would need an engine type addition or a convention.
- **Timeline insurance test.** Why deferred: the second insurance test is vacuous because the fixture has no death/distribution mechanism — revisit when fixture grows a helper.
- **Timeline keyboard: focus-follows-selection.** Arrow navigation scrolls and expands the next card but DOM focus stays put.
- **Timeline keyboard: scope to timeline container.** Handler is `window`-level; consider scoping.
- **Timeline keyboard: Home/End/PageUp/PageDown.** Not implemented in v1.
- **Timeline spine: shared setupFiles for jsdom tests.** Once a second jsdom test lands, move ResizeObserver/IntersectionObserver/fetch stubs from beforeEach to a shared vitest setup file.
- **Timeline hover transition scope.** `transition-all` on spine dots animates `top` too — flicker possible on rapid hovers. Scope to `[width,height,box-shadow,margin-top]` for v2.
- **Timeline IntersectionObserver segment-ref robustness.** Current observer only re-attaches on `projection` change — if future work causes segment churn without projection change, new segments won't be observed.
