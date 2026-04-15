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
