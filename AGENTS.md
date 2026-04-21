<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

Next.js 16 with React 19 and the App Router. APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project

Foundry Planning — cash-flow-based financial planning for advisors. Solo-dev app.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Neon Postgres + Drizzle ORM · Clerk auth · Upstash Redis (rate limiting) · Azure OpenAI (document extraction) · Vitest · Vercel · Tailwind v4 · Chart.js · TanStack Table · @react-pdf/renderer

## Commands

```bash
npm run dev          # dev server on :3000
npm run build        # production build
npm test             # vitest run (CI mode)
npm run test:watch   # vitest watch
npm run lint         # eslint
npm run seed:tax-data
npx drizzle-kit generate   # create migration from schema.ts
npx drizzle-kit migrate    # apply migrations
```

### Database tooling

Direct DB access via the Neon MCP (`mcp__plugin_neon_neon__*`) — prefer it over ad-hoc psql scripts:

- `run_sql` / `run_sql_transaction` — query against current branch
- `prepare_database_migration` → `complete_database_migration` — staged migration with preview (complements `drizzle-kit`, doesn't replace it)
- `compare_database_schema` — diff schemas between Neon branches
- `create_branch` / `reset_from_parent` — spin up throwaway branches for destructive migration tests
- `explain_sql_statement` / `list_slow_queries` — query perf debugging
- `describe_table_schema` / `get_database_tables` — introspection

Drizzle remains the source of truth for schema (`src/db/schema.ts`) — use MCP to *inspect* and *test*, not to author migrations.

## Folder map

```
src/
  app/
    (app)/     authenticated routes (clients, cma)
    (auth)/    sign-in / sign-up
    api/       route handlers (clients, cma, csp-report)
  components/  React UI — flat structure, one concern per file
  engine/      pure projection engine (tax, income, expenses, savings,
               liabilities, monteCarlo, socialSecurity, withdrawal).
               Must stay framework-free — no Next/DB imports.
  lib/         shared non-engine helpers (authz, audit, rate-limit,
               db-scoping, schemas, extraction, investments, tax/, timeline/)
  db/          Drizzle schema + migrations
  middleware.ts
data/          reference data (monte-carlo, tax seed workbook)
docs/
  future-work/             deferred items, per-category (see below)
  superpowers/plans/       implementation plans  (YYYY-MM-DD-feature.md)
  superpowers/specs/       design specs          (YYYY-MM-DD-feature-design.md)
  SECURITY_AUDIT.md        security findings + status
  SECURITY_HARDENING_LOG.md
  SECURITY_RUNBOOK.md
scripts/       one-off TS scripts run via tsx. `*.local.ts` is gitignored
               (convention for scripts that touch a live DB — mirrors .env.local)
.worktrees/    gitignored — feature branches live here (see workflow)
```

## Workflow

**New feature = new worktree.** Don't build features directly on `main`.

1. **Brainstorm** (`superpowers:brainstorming`) to align on scope before any code.
2. **Write a plan** (`superpowers:writing-plans`) → `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`. Design specs go to `docs/superpowers/specs/<slug>-design.md`.
3. **Create a worktree** (`superpowers:using-git-worktrees`) under `.worktrees/<slug>/`.
4. **Execute** via `superpowers:executing-plans` or `superpowers:subagent-driven-development`. TDD (`superpowers:test-driven-development`) for engine/lib work; frontend-design skills for UI.
5. **Verify** with `superpowers:verification-before-completion` and `vercel:verification` for end-to-end flows. `npm test` + `npm run lint` + manual browser check.
6. **Finish** via `superpowers:finishing-a-development-branch`. Only merge to `main` when the feature is fully done — no half-landed work on `main`.
7. When something gets scoped out, log it in the right `docs/future-work/*.md` file with a one-line "why deferred" note. Delete the entry when it ships.

### Session hygiene

- Use `splitting-sessions` when the topic shifts, after a rebase/merge/deploy mid-feature, or when resuming after a long gap. Cheaper than dragging context forward.
- For design questions, UI refactors, new pages, or "this doesn't look professional" work, use `ui-ux-pro-max` (primary) and `frontend-design:frontend-design` (secondary). React best-practices pass: `vercel:react-best-practices` after multi-TSX edits.
- After any non-trivial change, run `simplify` before claiming completion.

## Skills cheat sheet (when to reach for what)

| Situation | Skill |
|---|---|
| New feature / scoping | `superpowers:brainstorming` |
| Multi-step implementation | `superpowers:writing-plans` → `superpowers:executing-plans` |
| Isolating feature work | `superpowers:using-git-worktrees` |
| Writing engine/lib code | `superpowers:test-driven-development` |
| Any bug / test failure / "this isn't working" | `superpowers:systematic-debugging` (before proposing a fix) |
| Before claiming "done" | `superpowers:verification-before-completion` |
| Wrapping a feature | `superpowers:finishing-a-development-branch` |
| UI / visual design | `ui-ux-pro-max`, `frontend-design:frontend-design` |
| Topic shift / long gap | `splitting-sessions` |
| Post-edit cleanup | `simplify` |
| Security-sensitive change | `security-review` (slash-command) before merging |
| Deploy / env vars | `vercel:deploy`, `vercel:env-vars`, `vercel:verification` |
| Next.js / App Router questions | `vercel:nextjs`, `vercel:next-cache-components` |
| AI SDK / extraction work | `vercel:ai-sdk` |
| Cutting permission-prompt noise | `fewer-permission-prompts` |

## Gotchas

- **Engine purity.** `src/engine/` is framework-free. No Next/DB imports there — all IO happens in `lib/` or route handlers. Breaking this makes the engine untestable in plain vitest.
- **CSP is currently report-only** (`Content-Security-Policy-Report-Only` in `next.config.ts`). Violations flow to `/api/csp-report`. Flip to enforcing only after the report endpoint shows no real violations.
- **Rate limiting fails closed** — extract endpoint requires Upstash env vars; don't try to run it without them.
- **Live-DB scripts must be `*.local.ts`** — the `.local` suffix is gitignored (see `scripts/*.local.ts` in `.gitignore`). Committed scripts next to them omit the suffix.
- **Organization scoping.** All mutations go through `authz.ts` / `db-scoping.ts`; audit everything via `audit.ts`. Don't write ad-hoc queries that bypass org scoping.
- **Drizzle migrations** live in `src/db/migrations/`. Numbered sequentially — the `run-migration-0020.ts` pattern is for one-offs that can't be expressed in drizzle-kit output.
- **Dates are absolute.** Today's date comes from the session context; when you write it into plans/future-work, use `YYYY-MM-DD`, not "Tuesday" or "tomorrow".
- **Prefer Neon MCP over psql scripts** for one-off DB inspection. `mcp__plugin_neon_neon__run_sql` against the current branch is safer and leaves a clean tool-call trail.

## Tracking deferred work

Index: `docs/FUTURE_WORK.md` (P/E/L-scored priority table).
Per-category items live in `docs/future-work/*.md` (`engine.md`, `ui.md`, `reports.md`, etc.). When something is scoped out of a current task, add a bullet to the right category file with a one-line "Why deferred" note. When you ship something listed, delete the entry.
