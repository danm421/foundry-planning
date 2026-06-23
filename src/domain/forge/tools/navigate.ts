// src/domain/forge/tools/navigate.ts
//
// Non-mutating navigation tool: emits a `navigate` custom-event the client UI
// consumes to route the advisor to a section of the CURRENT client's plan (so
// they can show the client the actual chart/table). The section is validated
// against a fixed allowlist that mirrors the REAL route segments under
// `app/(app)/clients/[id]/` (a model-supplied free href is never honoured —
// emitNavigate additionally guards the allowlisted in-app prefixes as defence
// in depth). The path is built from `ctx.clientId` (server-derived), never a
// model-supplied id.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { ForgeToolContext } from "../context";
import { emitNavigate, emitPageLink } from "../custom-events";

// Model-facing section key → real route suffix under /clients/<id>/. Every
// suffix is verified to resolve to a real page.tsx. Shared by open_page
// (navigate) and cite_page (link chip).
const SECTION_PATHS = {
  // core
  overview: "overview",
  "balance-sheet": "assets/balance-sheet-report",
  cashflow: "cashflow",
  "income-expenses": "income-expenses",
  "monte-carlo": "cashflow/monte-carlo",
  scenarios: "solver",
  estate: "estate-planning",
  reports: "presentations",
  // cashflow detail
  "income-tax": "cashflow/income-tax",
  timeline: "cashflow/timeline",
  entities: "cashflow/entities",
  "stock-options": "cashflow/stock-options",
  // assets
  investments: "assets/investments",
  "net-worth": "details/net-worth",
  // estate detail
  "estate-flow": "estate-planning/estate-flow",
  "estate-tax": "estate-planning/estate-tax",
  "gift-tax": "estate-planning/gift-tax",
  liquidity: "estate-planning/liquidity",
  // other data
  insurance: "details/insurance",
  family: "details/family",
  assumptions: "details/assumptions",
  activity: "activity",
} as const;

type Section = keyof typeof SECTION_PATHS;
const SECTIONS = Object.keys(SECTION_PATHS) as [Section, ...Section[]];

// Human-readable chip label per section (server-derived; the model never
// supplies link text).
const SECTION_LABELS: Record<Section, string> = {
  overview: "Overview",
  "balance-sheet": "Balance Sheet",
  cashflow: "Cash Flow",
  "income-expenses": "Income & Expenses",
  "monte-carlo": "Monte Carlo",
  scenarios: "Scenarios",
  estate: "Estate Planning",
  reports: "Reports",
  "income-tax": "Income Tax",
  timeline: "Timeline",
  entities: "Entities",
  "stock-options": "Stock Options",
  investments: "Investments",
  "net-worth": "Net Worth",
  "estate-flow": "Estate Flow",
  "estate-tax": "Estate Tax",
  "gift-tax": "Gift Tax",
  liquidity: "Liquidity",
  insurance: "Insurance",
  family: "Family",
  assumptions: "Assumptions",
  activity: "Activity",
};

export function buildNavigateTools({ ctx }: ForgeToolContext): StructuredToolInterface[] {
  const openPage = tool(
    async ({ section }: { section: Section }) => {
      const href = `/clients/${ctx.clientId}/${SECTION_PATHS[section]}`;
      try {
        await emitNavigate(href); // throws if not allowlisted (defence in depth)
      } catch {
        return JSON.stringify({ error: "Could not open that page." });
      }
      return JSON.stringify({ navigated: true, section });
    },
    {
      name: "open_page",
      description:
        "Take the advisor to a page of the CURRENT client's plan in the app (so they can show the client the actual chart/table). Use when the advisor asks to 'open', 'show me', or 'go to' a section. Non-destructive; does not change any data.",
      schema: z.object({
        section: z.enum(SECTIONS).describe("which client section to open"),
      }),
    },
  );
  const citePage = tool(
    async ({ section }: { section: Section }) => {
      const href = `/clients/${ctx.clientId}/${SECTION_PATHS[section]}`;
      try {
        await emitPageLink(href, section, SECTION_LABELS[section]); // throws if not allowlisted
      } catch {
        return JSON.stringify({ error: "Could not attach that link." });
      }
      return JSON.stringify({ cited: true, section });
    },
    {
      name: "cite_page",
      description:
        "Attach a clickable link to your answer that takes the advisor to the page of the CURRENT client's plan where this data lives — WITHOUT navigating there yourself. Call this after answering a question whose figures or charts live on a specific page, so the advisor can jump there when ready. Non-destructive; does not change data or move the advisor.",
      schema: z.object({
        section: z.enum(SECTIONS).describe("which client section holds this data"),
      }),
    },
  );
  return [openPage, citePage];
}
