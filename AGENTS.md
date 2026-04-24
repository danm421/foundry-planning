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

Direct DB access via the Neon MCP (`mcp__Neon__*`, remote server at `https://mcp.neon.tech/mcp`) — prefer it over ad-hoc psql scripts:

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
docs/          SECURITY_AUDIT.md, SECURITY_HARDENING_LOG.md, SECURITY_RUNBOOK.md,
               design_handoff_estate_planning/  (HTML mockups for estate report)
scripts/       one-off TS scripts run via tsx. `*.local.ts` is gitignored
               (convention for scripts that touch a live DB — mirrors .env.local)
.worktrees/    gitignored — feature branches live here (see workflow)
```

**Planning docs live in the Obsidian vault, not the repo.** Specs, plans,
future-work, and session handoffs all live at `~/Documents/foundry-finance/`.
See [§Planning vault](#planning-vault) below for the full layout + CLI recipes.

## Workflow

**New feature = new worktree.** Don't build features directly on `main`.

All specs, plans, future-work, and handoffs go to the Obsidian vault at
`~/Documents/foundry-finance/` — not the repo. See [§Planning vault](#planning-vault).

1. **Resume context.** Read `~/Documents/foundry-finance/Now.md` for what's in flight + next up. When resuming after `/clear`, read the newest file in `~/Documents/foundry-finance/handoffs/`.
2. **Brainstorm** (`superpowers:brainstorming`) to align on scope before any code.
3. **Write the spec** (emitted by brainstorming) → `~/Documents/foundry-finance/specs-foundry-planning/YYYY-MM-DD-<slug>-design.md`. Add frontmatter: `type: spec`, `status: proposed`, `date`, topic tag.
4. **Write the plan** (`superpowers:writing-plans`) → `~/Documents/foundry-finance/plans/YYYY-MM-DD-<slug>.md`. Frontmatter: `type: plan`, `status: proposed`, `spec: "[[<spec>]]"`, topic tag.
5. **Create a worktree** (`superpowers:using-git-worktrees`) under `.worktrees/<slug>/`. Flip the plan's `status` to `in-progress` and update `Now.md`.
6. **Execute** via `superpowers:executing-plans` or `superpowers:subagent-driven-development`. TDD (`superpowers:test-driven-development`) for engine/lib work; frontend-design skills for UI.
7. **Verify** with `superpowers:verification-before-completion` and `vercel:verification` for end-to-end flows. `npm test` + `npm run lint` + manual browser check.
8. **Finish** via `superpowers:finishing-a-development-branch`. Only merge to `main` when the feature is fully done. Flip plan `status: shipped`, move to `~/Documents/foundry-finance/plans/archive/`, update `Now.md` and the relevant `future-work/*.md`.
9. When something gets scoped out, log it in the right `~/Documents/foundry-finance/future-work/*.md` file with a one-line "why deferred" note. Delete the entry when it ships.

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
- **Prefer Neon MCP over psql scripts** for one-off DB inspection. `mcp__Neon__run_sql` against the current branch is safer and leaves a clean tool-call trail.

## Tracking deferred work

Future-work lives in the Obsidian vault at `~/Documents/foundry-finance/future-work/*.md` split by category (`engine.md`, `ui.md`, `reports.md`, `analytics.md`, `client-data.md`, `integrations.md`, `monte-carlo-v2.md`, `reports.md`, `schema.md`, `security-hardening.md`, `timeline-report.md`, `tooling.md`). Cross-cutting index: `~/Documents/foundry-finance/future-work/_Future Work Index.md`.

Items are P/E/L-scored (Priority 1-10, Ease 1-10, Leverage 1-10). When something is scoped out of a current task, add a bullet to the right category file with a one-line "Why deferred" note. When you ship something listed, delete the entry and add a link in the file's `## Related specs & references` section to the spec that shipped it.

## Planning vault

The vault at `~/Documents/foundry-finance/` is the source of truth for everything non-code related to planning.

```
~/Documents/foundry-finance/
├── Home.md                          entry point / dashboard
├── Now.md                           what's in flight + next up + recent ships
├── _Specs Index.md                  topic-grouped index of all specs
├── _Plans Index.md                  active + archived plans
├── specs-foundry-planning/          35 specs (YYYY-MM-DD-<slug>-design.md)
├── plans/                           active plans (YYYY-MM-DD-<slug>.md)
│   └── archive/                     shipped plans
├── handoffs/                        session handoffs (YAML, from splitting-sessions)
│   └── _Handoffs Index.md
├── future-work/                     deferred items by category
│   └── _Future Work Index.md
├── eMoney Docs/                     3rd-party reference material
│   └── _eMoney Docs Index.md
└── design_handoff_estate_planning/  HTML mockups for estate report
```

**Frontmatter convention (already applied everywhere):**

| Type | Required fields |
|---|---|
| spec | `title`, `date`, `status`, `type: spec`, `tags: [spec, <topic>]` |
| plan | `title`, `date`, `status`, `type: plan`, `spec: "[[<spec>]]"`, `tags: [plan, <topic>]` |
| future-work | `title`, `status: tracker`, `type: future-work`, `tags: [future-work, <topic>]` |

**Status values:** `proposed` · `in-progress` · `spec-complete` · `shipped` · `shipped-phase-1` · `paused` · `deferred` · `abandoned`

**Topic tags:** `tax`, `social-security`, `cma-investments`, `monte-carlo`, `engine`, `reports`, `ui`, `admin`, `estate`, `extraction`, `fixes`, `client-data`, `integrations`, `security`, `tooling`, `analytics`, `schema`.

**Obsidian CLI recipes** (Obsidian must be running):

| Task | Command |
|---|---|
| Where did we leave off? | `obsidian search:context query="status: in-progress" path="plans/"` |
| Find a topic across specs+plans | `obsidian search:context query="<term>"` |
| Which specs cite this one? | `obsidian backlinks file="<spec-name>"` |
| All tax-related files | `obsidian tag name=tax verbose` |
| Flip plan status | `obsidian property:set name="status" value="shipped" file="<plan>"` |
| Append a deferred item | `obsidian append file="future-work/<cat>" content="- New item..."` |
| Check broken wikilinks | `obsidian unresolved counts` |

**Resuming after `/clear`:** first message reads `Now.md` and the newest `handoffs/*.yaml`. Those two files plus the in-progress plan's frontmatter should fully re-orient the session.

**Bug-list gotcha:** bare `#14` / `#23-24` in prose gets parsed by Obsidian as tags. Backtick them: `` `#14` ``.
