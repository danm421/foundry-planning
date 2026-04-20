# Foundry Planning

Cash flow-based financial planning platform for financial advisors.

## Tech Stack

- **Next.js** (App Router) + TypeScript
- **Neon** (serverless Postgres) + **Drizzle** ORM
- **Clerk** authentication
- **Chart.js** + **TanStack Table**
- Deployed on **Vercel**

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in your keys
2. `npm install`
3. `npm run dev`
4. Open [http://localhost:3000](http://localhost:3000)

## Database

Generate and run migrations:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

## Admin tool

- Design spec: [docs/superpowers/specs/2026-04-20-admin-tool-phase-1-design.md](docs/superpowers/specs/2026-04-20-admin-tool-phase-1-design.md)
- Implementation plans:
  - Plan 1 (Foundations — this repo state): [docs/superpowers/plans/2026-04-20-admin-tool-foundations.md](docs/superpowers/plans/2026-04-20-admin-tool-foundations.md)
  - Plan 2 (Admin shell + impersonation): TBD
  - Plan 3 (Audit viewer + cutover): TBD
- Key primitives:
  - `@foundry/auth` — `getActingContext()`, `requireRole()`, `ActingContext`
  - `@foundry/db/admin-scope` — `adminQuery()`, `writeAuditLog()`, `defaultAuditInserter`
