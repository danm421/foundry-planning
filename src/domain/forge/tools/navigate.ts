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
import { emitNavigate } from "../custom-events";

// Model-facing section key → real route suffix under /clients/<id>/.
// Suffixes verified against the live routes + the advisor nav (header-subtabs):
// monte-carlo is nested under cashflow; "estate" → estate-planning;
// "reports" → presentations; "scenarios" → the solver workspace.
const SECTION_PATHS = {
  overview: "overview",
  "balance-sheet": "assets/balance-sheet-report",
  cashflow: "cashflow",
  "income-expenses": "income-expenses",
  "monte-carlo": "cashflow/monte-carlo",
  scenarios: "solver",
  estate: "estate-planning",
  reports: "presentations",
} as const;

type Section = keyof typeof SECTION_PATHS;
const SECTIONS = Object.keys(SECTION_PATHS) as [Section, ...Section[]];

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
  return [openPage];
}
