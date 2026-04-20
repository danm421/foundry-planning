# Handoff Prompt — Estate Prerequisites, Item 1 of 8

Paste the block below into a fresh Claude Code session in the
`foundry-planning` repo.

---

We're building toward the Estate Planning report designed in
`docs/design_handoff_estate_planning/`. The full gap analysis and
8-step build order are in
`docs/design_handoff_estate_planning/PREREQUISITES.md` — read that
first. Future sessions will pick up items 2–8 from that list.

**Your job this session is item 1 only: Family members as owners /
beneficiaries.** Do not start any other item. Do not touch the UI
canvas from the design HTML.

## What "done" looks like for item 1

Extend the data model so children, grandchildren, and charities
(non-client individuals and named entities) can be designated as
**owners** and/or **beneficiaries** of accounts and trusts. Today
`family_members` rows are informational only — this item turns them
into first-class owning/receiving parties.

Downstream consumers that need this (do not build these, but design
with them in mind):
- **Item 2 (trust data model)** will reference family members / charities
  as `remainder` beneficiaries on trusts.
- **Item 4 (death-sequence events)** will distribute assets to named
  beneficiaries at second death.
- The design's **beneficiary strip** (Tom Jr., Sarah, Stanford, SLAT
  remainder) and the Impact & Beneficiaries Sankey both render from
  this model.

## Concrete deliverables

1. Schema migration (additive):
   - A beneficiary type that can point to either a `family_member` or a
     named external party (e.g. Stanford). Consider whether to extend
     `family_members` with a `kind` enum (`individual` / `charity`) or
     add a separate `external_beneficiaries` table — decide in
     brainstorming.
   - Per-account beneficiary designations: primary + contingent, with
     percentages summing to 100.
   - Per-trust remainder beneficiaries (same shape).
   - Optional: per-account owner override so a family member can own an
     account (e.g. custodial / UTMA). Discuss tradeoffs before
     committing.
2. API routes following existing patterns in
   `src/app/api/clients/[id]/` (see `entities/`, `accounts/` for
   shape). Zod-validated per the schemas in `src/lib/schemas/`.
3. Minimal UI: extend the existing Client Data → Family page
   (`src/app/(app)/clients/[id]/client-data/family/page.tsx`) so
   advisors can mark family members as beneficiaries of specific
   accounts / trusts. UI quality-bar: functional, matches the app's
   existing Client Data form style. No canvas work.
4. Engine: **no behavior changes this session** — beneficiary data
   should be loaded and made available on the projection input types,
   but not yet acted on. Item 4 wires it to death events.
5. Tests:
   - Vitest unit tests for any new validation helpers and resolver
     logic.
   - Tenant-isolation test coverage per the pattern in
     `src/__tests__/tenant-isolation.test.ts`.

## Working rules

- Follow `AGENTS.md` — this Next.js is not the one in your training
  data; read `node_modules/next/dist/docs/` for anything App Router
  related.
- Use `superpowers:brainstorming` first to pin the data model (owner
  override yes/no, external-beneficiaries table vs. extending
  `family_members`, primary/contingent shape).
- After brainstorming, use `superpowers:writing-plans` to write a
  spec under `docs/superpowers/specs/` and stop for review before
  coding.
- Use `superpowers:test-driven-development` for any engine-side
  helpers.
- Migrations additive only; backfill existing rows with safe
  defaults. No destructive drops.
- When complete, run `superpowers:requesting-code-review` against the
  spec before calling it done.
- Anything scoped out mid-session goes in `docs/FUTURE_WORK.md` with
  a one-line "Why deferred" note per the AGENTS.md rule.

## Explicitly out of scope

- Items 2–8 from PREREQUISITES.md. Do not pre-build trust sub-types,
  gift primitives, death events, estate tax, step-up, or ILIT logic
  even if they feel close. Stop at "beneficiaries can be designated
  and persisted."
- The flowchart canvas, projection panel, scrubber, Sankey — any UI
  from the design HTML.
- Scenario switcher (FUTURE_WORK #1, parallel track).

## Start here

Read:
1. `docs/design_handoff_estate_planning/PREREQUISITES.md`
2. `docs/design_handoff_estate_planning/README.md` (for what the
   beneficiary strip and trust remainder downstream need)
3. The `family_members`, `entities`, and `accounts` sections of
   `src/db/schema.ts`
4. The existing Family page at
   `src/app/(app)/clients/[id]/client-data/family/page.tsx`

Then invoke `superpowers:brainstorming` to scope the data model.
