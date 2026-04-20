# Future Work — Tooling

- **React component testing setup (RTL)** _(P3 E5 L2)_ — the repo has vitest
  for pure-logic tests but no React Testing Library. The tax drill-down modal
  (and earlier UI work) is validated by manual smoke test only. Adding RTL
  would let us write component-level tests for modal interactions, table
  rendering, keyboard accessibility, etc. _Why deferred: manual smoke tests
  have caught all issues so far; setup overhead not justified per-feature._

- **Scheduled / automated migrations in CI** _(P2 E7 L5)_ — migrations are
  applied manually via `drizzle-kit migrate` against the Neon URL in
  `.env.local`. _Why deferred: single dev, single environment for now._
