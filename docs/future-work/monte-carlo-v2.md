# Future Work — Monte Carlo v2 (shipped 2026-04-19)

- **Interactive Variables / what-if panel** on the MC report. Why deferred: what-if editing is a distinct feature from MC rendering; needs its own spec.
- **"View Scenario" CTA** on the MC report header. Why deferred: destination route not yet defined; button renders visible-but-disabled.
- **AI-generated recommendations card content.** Why deferred: advisor-authored content layer, not code-generated.
- **Top Risks card + `computeTopRisks` pure helper.** Why deferred: user removed the card from v2 per checkpoint-3 feedback. Helper + tests retained for possible future resurrection.
- **`Est. Median Value` row + delta vs cash-flow on FindingsCard.** Why deferred: removed per checkpoint-3 feedback. `deterministic` series is still computed for the fan-chart overlay, so surfacing the delta later is a small lift.
- **Web Worker execution for MC trials.** Why deferred: main-thread with yieldEvery:50 is adequate at 1k trials; revisit at 10k.
- **Correlation matrix admin UI.** Why deferred: DB edits only for now; no user demand yet.
- **Per-plan `requiredMinimumAssetLevel` column.** Why deferred: hardcoded to 0 in `/api/clients/[id]/monte-carlo-data`; add a `plan_settings` column when prioritized.
- **Inflation randomization.** Why deferred: inflation-tied accounts stay fixed-rate per v1 scoping.
- **Orchestrator smoke test** (`monte-carlo-report.test.tsx`). Why deferred: skipped during Phase 5; the component's visual contract is exercised manually each checkpoint, and pure-helper tests cover the data-transform surface.
- **Cash-flow `portfolioAssets.total` excludes non-liquid categories.** Why deferred (flagged in-session): the cash-flow report's portfolio total currently includes real estate / business / life insurance. MC uses a liquid-only total. User acknowledged this as a separate cashflow fix outside this session.
