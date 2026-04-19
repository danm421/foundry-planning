# Monte Carlo Simulation — Build Handoff

Paste this as your opening message in a new Claude Code session. Re-attach the eMoney PDF (`Monte Carlo eMoney Technical Document2020.pdf`) as the authoritative algorithm reference if you have it — but this prompt is self-contained.

**Workspace:** this work lives on branch `monte-carlo-planning` in the worktree `.worktrees/monte-carlo-planning` (branched from `main`). `cd` into that worktree before starting. Reference files in this prompt are at `data/monte-carlo/` inside that worktree.

---

## Your task

Add a Monte Carlo simulation module to this financial planning app. It wraps the existing deterministic projection engine with randomized, correlated, lognormal returns — following the eMoney methodology (see "Algorithm" below). Output a success-probability + percentile distribution of ending portfolio values.

Do **NOT** start coding. First investigate, then confirm the plan with me, then proceed phase by phase with Vitest tests at each step.

## App context

- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Drizzle + Neon Postgres + Clerk + Vitest
- **Engine:** `src/engine/` — 9 modules, public API in `src/engine/index.ts`:
  - `runProjection`, `calculateTaxes`, `computeIncome`, `computeExpenses`, `computeLiabilities`, `applySavingsRules`, `executeWithdrawals`, `calculateRMD`, `amortizeLiability`
  - Types: `ClientData`, `ProjectionYear`, `AccountLedger`, `PlanSettings`, etc.
- **Execution pattern:** Client-side engine run, driven by `/api/clients/[id]/projection-data` which assembles `ClientData` (with CMA resolution). Reference: CashFlow report.
- **CMA schema (already has what MC needs):** `assetClasses` table in `src/db/schema.ts` has `geometricReturn`, `arithmeticMean`, `volatility`, plus a new `assetType` column (migration 0033). Per-client overrides live in `clientCmaOverrides`.
- **What's missing for MC:** a correlation matrix table + wiring.

## Reference files in the repo

- `data/monte-carlo/Monte Carlo eMoney Technical Document2020.pdf` — **authoritative methodology** (if present; otherwise see Algorithm section below)
- `data/monte-carlo/Sample Correlation matrix.xls` — sample 15×15 matrix with arith/geo/SD per index
- `data/monte-carlo/sample-correlations.json` — same data extracted to JSON; consume directly

## Algorithm (distilled from eMoney methodology doc)

### Inputs per "used" index/asset class
- `arithMean` (used by MC)
- `geoMean` (used by straight-line projection — already in place)
- `stdDev`
- Relationship: `Geo ≈ Arith − SD²/2`
- Correlation matrix ρ between all used indices (symmetric, 1s on diagonal)

### Initial setup (once per MC run)
1. **Filter to "used" indices** — any asset class referenced by an account, the CPI/inflation index, the bond index used for annuities, or anything referenced by an asset/fact. Unused indices don't participate.
2. **Lognormal conversion** per index (stock returns are lognormal):
   - `v = SD²` (variance)
   - `m² = (1 + arithMean)²`
   - `lnvar = ln(1 + v/m²)`
   - `μ = (1/2) · ln(m² · m² / (m² + v))` (ln-space mean)
   - `σ = √lnvar` (ln-space SD)
3. **Covariance matrix:** `Cov(x,y) = ρ(x,y) · σ(x) · σ(y)` (uses the ln-space σ). Diagonal = `lnvar(x)`.
4. **Cholesky decomposition** L of the covariance matrix — computed once, reused every trial.

### Per year, per trial
1. Generate random vector `Z ~ N(0,1)` — one entry per used index. Seeded PRNG (see Repeatability below).
2. Correlated ln-space innovation: `X = L · Z` (vector).
3. Add ln-mean: `Y = X + μ` (vector).
4. Back to arithmetic returns: `r_i = exp(Y_i) − 1` for each index.
5. Cap: clamp each `r_i` to `[-1.0, 2.0]` (i.e. -100%/+200%).
6. Apply `r_i` as the annual return for each index/asset class in that year's projection.
7. **Custom/fixed growth rates do NOT randomize** — if an asset is set to a fixed 8%, it stays 8% every year. Only index-tied rates vary.
8. **Overridden CPI (What-If inflation scenario) does NOT randomize.**
9. **Explicit bear-market overrides** (if you add them) stay fixed during their window.
10. Run the existing one-year projection step using these rates.

### Per trial
- Trial **succeeds** iff both:
  - Portfolio assets ≥ **Required Minimum Asset Level** at end of simulation (configurable; default 0 or a user-set "Desired Remaining Asset Level"), AND
  - Portfolio assets ≥ $0 in every year of the simulation.
- "Portfolio assets" = liquid investments in client/spouse estate. **Excludes** real estate, businesses, out-of-estate assets.

### Repeatability
- **Seed the PRNG** and persist the seed per simulation run. Same inputs + same seed = identical output, trial by trial. Provide an explicit "Restart / reseed" action that generates a new seed.
- Recommended PRNG: Mulberry32 or xoshiro128** (small, seedable, fast). `Math.random()` is not seedable — don't use it.
- Box–Muller for N(0,1) sampling from uniform.

### Defaults
- **1,000 trials** default, configurable.
- Support **interruption**: user can stop partway through and see partial results.

## Integration points to investigate FIRST (don't code yet)

1. **`src/engine/projection.ts`** — understand how deterministic returns are currently applied. You'll parameterize this to accept an injected return vector per year per trial. Look for where `geometricReturn` is read.
2. **`src/engine/index.ts`** — the 9 exported functions + types. Plan where `runMonteCarlo` fits (probably a new export).
3. **`src/app/api/clients/[id]/projection-data/route.ts`** — how `ClientData` is assembled with CMA resolution. The MC module consumes the same `ClientData`.
4. **`src/db/schema.ts`:293** — `assetClasses` (has `arithmeticMean`, `volatility`, `assetType`, `sortOrder`) — no new fields needed on this table.
5. **`src/lib/cma-seed.ts` + `src/app/api/cma/seed/route.ts`** — existing CMA seeding flow; mirror this pattern for correlation matrix seeding.
6. **`src/lib/palette.ts`** — `colorForAssetType`, `shadeForClassInType` for later MC visualization.
7. **CashFlow report (already shipped)** — study how it runs the engine client-side; MC UI will likely follow the same pattern but might need a Web Worker for performance.

## Open questions — resolve with me BEFORE coding

1. **Correlation scope:** correlations at asset-class level (15 indices in sample) or asset-type level (fewer, coarser)? Sample is asset-class; I'm open.
2. **Sample-to-production mapping:** the 15 sample indices (`sp500`, `sp400`, `sp600`, `ifci`, `lehhighyld`, `lehaggregate`, `leh3yrmuni`, `leh10yrmuni`, `leh20yrmuni`, `ips`, `msci`, `nareitall`, `csfbhedge`, `30daytbill`, `cpi`) need mapping to whatever asset classes currently exist in our seed. Propose a mapping plan; don't assume.
3. **Inflation (CPI):** how does the existing engine handle inflation? If there's already a deterministic CPI input (`src/lib/inflation.ts`), should MC randomize it by default, or keep the doc's behavior where only un-overridden CPI randomizes?
4. **Where to run:** client-side (matches CashFlow), Web Worker (keeps UI responsive for 1000 trials), or server-side (Fluid Compute, could cache)? I lean Web Worker — confirm.
5. **Persistence:** store MC runs in DB (`monte_carlo_runs` table with seed + summary)? Or recompute on demand? Implications for comparing scenarios over time.
6. **"Used" index detection:** what exactly counts as used in our model — only asset classes referenced by a client's holdings, or the whole firm CMA library?
7. **Required Minimum Asset Level:** new per-client field, per-plan setting, or global default 0? eMoney stores it per client.
8. **Custom growth rates:** do any of our existing account/asset types support a custom fixed rate today? If not, this is a non-issue until we add them.

## Suggested phased plan

Work TDD. After each phase, stop and show me tests + results before moving on.

**Phase 1 — Math primitives** (pure, no engine dependencies)
- `src/engine/monteCarlo/prng.ts` — Mulberry32 seeded PRNG
- `src/engine/monteCarlo/normal.ts` — Box–Muller N(0,1) from PRNG
- `src/engine/monteCarlo/cholesky.ts` — Cholesky decomposition (~15 lines)
- `src/engine/monteCarlo/lognormal.ts` — arith+SD → (μ, σ) conversion; `exp(x)-1` inverse
- Tests: golden numbers from the eMoney doc's worked example (section "Calculating the Monte Carlo" pages 8–10). Match every intermediate value.

**Phase 2 — Return generator**
- `src/engine/monteCarlo/returns.ts` — builds covariance, Cholesky, per-year correlated return vector
- Input: `{ indices, arithMean[], stdDev[], correlation[][] }`, `seed`, `years`
- Output: `number[][]` — `[trial][year]` returns per index (or a streaming iterator)
- Apply rate caps here.
- Tests: statistical tests across N=10,000 trials — mean ≈ arithMean, SD ≈ stdDev, empirical correlation matches input within tolerance.

**Phase 3 — Correlation matrix data layer**
- New Drizzle table `asset_class_correlations` (firm-scoped pair `(assetClassIdA, assetClassIdB, rho)` with uniqueness + symmetry constraint OR single-row JSON column — your call, argue tradeoffs)
- Drizzle migration
- Seed loader from `data/monte-carlo/sample-correlations.json` with asset-class-id mapping
- API route + admin UI to view/edit (follow existing CMA admin UI patterns — see `cma-client.tsx` / `AssetClassRow`)

**Phase 4 — Engine wrap**
- `src/engine/monteCarlo/trial.ts` — one-trial driver that runs the existing projection with an injected yearly return vector
- Refactor `runProjection` minimally to accept an optional `returnsOverride: (year, assetClassId) => number` injection; deterministic path untouched
- Per-trial success/failure check
- Tests: a known-success plan (huge assets, zero expenses) returns success; a known-fail plan (zero assets, huge expenses) returns fail

**Phase 5 — Orchestrator**
- `src/engine/monteCarlo/run.ts` — `runMonteCarlo(clientData, { trials, seed, yearsHorizon, requiredMinimum }) → { seed, trials, successRate, percentiles, byYearDistribution }`
- Support cancellation (AbortSignal) and progress callback
- Deterministic under fixed seed — unit test this

**Phase 6 — Result types + aggregation**
- Percentiles (2.5, 25, 50, 75, 97.5), min, max, mean ending value
- Per-year distribution (for fan-chart visualization later)
- Export from `src/engine/index.ts`

**Phase 7 — Wiring**
- `/api/clients/[id]/projection-data` already returns `ClientData`; MC consumes this without changes
- Decide client vs Web Worker execution
- Minimal report page at `/clients/[id]/monte-carlo` with success rate + percentile table (full UI is a separate feature — scope-limit this phase)

## Non-goals for v1 (defer to `docs/FUTURE_WORK.md`)

- Fat-tailed distributions (Student-t, jump-diffusion)
- Serial correlation (year N-1 → year N)
- Regime-switching / Markov-chain models
- Historical bootstrap resampling (as an alternative to parametric)
- Dynamic allocation glidepaths mid-simulation
- Sequence-of-returns stress tests (explicit bear-market injection UI)
- Variance reduction (antithetic variates, quasi-Monte Carlo)
- Correlation editing UI — for v1, seed once from JSON and read-only is fine
- Worker pool / parallelization beyond a single worker
- MC result persistence — OK to recompute per view for v1

## Coding standards (this repo)

- Read `AGENTS.md` first. This is Next.js 16 with breaking changes from prior versions — check `node_modules/next/dist/docs/` before writing routes/APIs.
- When you defer anything from v1, append a bullet to `docs/FUTURE_WORK.md` with a one-line "Why deferred".
- TDD: write the test, see it fail, then implement. Vitest.
- Don't add speculative abstractions. If the primitive takes 15 lines, write 15 lines.
- Match existing patterns: look at how `cma-seed`, `inflation`, `palette` are structured before inventing.

## Acceptance criteria (for the whole feature)

1. Given the sample `sample-correlations.json`, `runMonteCarlo` reproduces the eMoney worked example's intermediate values (μ, σ, covariance, Cholesky) exactly.
2. Same seed → same output, byte-identical.
3. 1,000 trials × 30 years runs in < 2s on a modern laptop (client-side or worker).
4. Empirical statistics over 10,000 trials match inputs within 1% (mean, SD, pairwise correlation).
5. No regression in the existing deterministic projection — all existing engine tests pass.
6. Vitest coverage: each math primitive + the orchestrator has unit tests.

---

**Start by:** reading `src/engine/projection.ts`, `src/engine/index.ts`, `src/app/api/clients/[id]/projection-data/route.ts`, `src/db/schema.ts` (assetClasses section), and `data/monte-carlo/sample-correlations.json`. Then come back with (a) your understanding of how returns are currently applied in `runProjection`, (b) answers/proposals for the 8 open questions above, (c) a refined Phase 1 plan.
