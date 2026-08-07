<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

Next.js 16 with React 19 and the App Router. APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project

Foundry Planning — cash flow based financial planning for advisors. 

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Neon Postgres + Drizzle · Clerk · Upstash Redis · Azure OpenAI (document extraction) · Vitest · Vercel · Tailwind v4 · Chart.js · TanStack Table · @react-pdf/renderer

```bash
npm run dev | build | test | lint     # test = vitest run (CI mode)
npx drizzle-kit generate | migrate    # src/db/schema.ts is the source of truth
```

## Gotchas

- **Engine purity.** `src/engine/` is framework-free — no Next/DB imports. All IO happens in `lib/` or route handlers. Breaking this makes the engine untestable in plain vitest.
- **Org scoping.** Every mutation goes through `authz.ts` / `db-scoping.ts` and is audited via `audit.ts`. Never write ad-hoc queries that bypass scoping.
- **Live-DB scripts must be `*.local.ts`** — that suffix is gitignored. Committed scripts next to them omit it.
- **Rate limiting fails closed** — the extract endpoint needs Upstash env vars; don't try to run it without them.
- **CSP is report-only** (`next.config.ts`); violations flow to `/api/csp-report`. Don't flip to enforcing until that endpoint is quiet.
- **DB inspection → Neon MCP** (`mcp__Neon__run_sql`), not ad-hoc psql. Use MCP to *inspect and test*; author migrations with drizzle-kit.
- `src/components/` is flat — one concern per file.

## How to talk to me

- **Ask first, always.** If I need to do or decide something, that's line 1 in plain English. Nothing above it.
- **Keep the ask to one or two sentences.** Just the question and what it unblocks — no setup, no background, no options I didn't ask for. If I need more I'll ask.
- **Open every report with one of:** `✅ Done — <what changed>` · `❓ Need you — <the question>` · `⛔ Blocked — <what's stopping me>`.
- **Under 150 words.** Detail goes below a `---`, or in the vault. Assume I stop reading after the first paragraph.
- **No reasoning dumps.** Don't explain why you didn't do something in more than one sentence. Don't restate gates that passed — "gates green" is enough.
- **Commands I should run go alone**, in a code block, with nothing after them.

## Coding posture

- **Orphans only.** Remove imports/vars/functions *your* change made unused. Leave pre-existing dead code alone — mention it instead of deleting.
- **Senior-engineer test.** Before claiming done, ask: "would a senior engineer call this overcomplicated?" If yes, simplify first. Run `simplify` after any non-trivial change.
- **Subagent dispatches must pass `model`** — they default to Opus otherwise. Lookups/`Explore` → `haiku`; DB inspection, test runs, status checks → `sonnet`; design, unknown-cause debugging, and anything in `src/engine/` → `opus`.

## Workflow

**Default: just do the task.** Read, edit, test, report. Bug fixes, copy and style tweaks, single-component changes, adding a test, refactors inside a file or two, dependency bumps, DB inspection — none of these need ceremony. **This explicitly overrides the default-to-invoke posture in `using-superpowers`.** When it's genuinely ambiguous, ask rather than assuming the heavy path.

**Full pipeline only for substantial new features** — work spanning 3+ areas (engine + lib + UI), needing a schema migration, or reshaping a user-facing flow end to end. Also whenever I ask for a spec or plan by name:

Superpowers Brainstorm → spec → plan → worktree under `.worktrees/<slug>/` → execute (TDD for engine/lib) → verify (`npm test`, `npm run lint`, browser check) → `superpowers:finishing-a-development-branch`. Features get their own worktree, never `main`; merge only when fully done.

Individual skills still apply on their own merits at any size — `systematic-debugging` when a cause is unknown, `simplify` after non-trivial edits. It's the multi-step spec/plan pipeline that's opt-in, not every skill.

Planning docs live in the Obsidian vault, never in the repo: `~/Documents/brain/20-projects/foundry-planning/` (`specs/`, `plans/`, `handoffs/`, `future-work/`). **Read `~/Documents/brain/AGENTS.md` before writing a spec, plan, or future-work entry** — it holds the frontmatter schema, status values, topic tags, and Obsidian CLI recipes. Resume context from `~/Documents/brain/Now.md` plus the newest `handoffs/`.

Scoped-out work gets a bullet in the matching `future-work/*.md` with a one-line "why deferred" and a P/E/L score (Priority / Ease / Leverage, 1-10 each). Delete the entry when it ships.

For UI work, use `ui-ux-pro-max` alongside the `Foundry-design-system` skill.
