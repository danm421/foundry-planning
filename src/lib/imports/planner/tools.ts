// src/lib/imports/planner/tools.ts
//
// The planning reasoner's bounded tool set. Task 13's agentic loop hands
// these four tools to a chat model: two read-only lookups over the source
// document and the merged extraction payload, one injected estimator, and
// one write tool that records a single proposal in a closure variable for
// the caller to retrieve via `getProposal()`. Mirrors the `tool()` idiom in
// `src/domain/forge/tools/plan-builder.ts`.
//
// This module stays free of `src/engine/` and tax-params imports — PIA
// estimation is INJECTED via `PlannerToolContext.estimatePia` rather than
// imported, so the tool loop itself has no engine dependency.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { formatZodIssues } from "@/lib/schemas/common";
import type { ImportPayload } from "../types";
import { planningDecisionsSchema, type PlanningDecisions } from "./types";

const MAX_CHARS = 60_000;

function truncate(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}... [truncated]` : text;
}

export interface PlannerToolContext {
  documentText: string;
  pages: string[];
  payload: ImportPayload;
  estimatePia: (input: EstimatePiaToolInput) => number;
}

export interface EstimatePiaToolInput {
  highestAnnualSalary: number;
  yearsEmployed: number;
  futureYears: number;
}

const LIST_EXTRACTED_ENTITIES = [
  "accounts", "incomes", "expenses", "liabilities", "savings",
  "goals", "dependents", "lifePolicies", "entities",
] as const;

export function buildPlannerTools(
  ctx: PlannerToolContext,
): { tools: StructuredToolInterface[]; getProposal: () => PlanningDecisions | null } {
  let proposal: PlanningDecisions | null = null;

  const readDocument = tool(
    async ({ startPage, endPage }: { startPage?: number; endPage?: number }) => {
      if (startPage === undefined && endPage === undefined) {
        return truncate(ctx.documentText);
      }
      const start = (startPage ?? 1) - 1;
      const end = endPage ?? ctx.pages.length;
      return truncate(ctx.pages.slice(start, end).join("\n"));
    },
    {
      name: "read_document",
      description:
        "Read the source document's text, optionally restricted to a page range. " +
        "Omit both startPage and endPage to read the whole document. Returned text " +
        "is capped at 60,000 characters.",
      schema: z.object({
        startPage: z.number().int().min(1).optional().describe("First page to read, 1-indexed."),
        endPage: z.number().int().min(1).optional().describe("Last page to read, 1-indexed, inclusive."),
      }),
    },
  );

  const listExtracted = tool(
    async ({ entity }: { entity: (typeof LIST_EXTRACTED_ENTITIES)[number] }) => {
      return JSON.stringify(ctx.payload[entity] ?? null);
    },
    {
      name: "list_extracted",
      description:
        "List the previously extracted rows for one entity type from the fact-finder " +
        "payload, as JSON.",
      schema: z.object({
        entity: z.enum(LIST_EXTRACTED_ENTITIES).describe("Which extracted entity to list."),
      }),
    },
  );

  const estimateSsPia = tool(
    async (input: EstimatePiaToolInput) => {
      return JSON.stringify({ piaMonthly: ctx.estimatePia(input) });
    },
    {
      name: "estimate_ss_pia",
      description:
        "Estimate a Social Security Primary Insurance Amount (monthly, in today's " +
        "dollars) from a highest annual salary, years employed so far, and years of " +
        "future employment before claiming.",
      schema: z.object({
        highestAnnualSalary: z.number().describe("Highest sustained annual salary, in dollars."),
        yearsEmployed: z.number().describe("Years employed so far."),
        futureYears: z.number().describe("Years of future employment before claiming."),
      }),
    },
  );

  const proposeDecisions = tool(
    async ({ decisions }: { decisions: unknown }) => {
      const parsed = planningDecisionsSchema.safeParse(decisions);
      if (!parsed.success) {
        // Include the PATH, not just the message. R6 took the number of
        // rejectable numeric fields from zero to ~12, so "Too big: expected
        // number to be <=1; Too big: expected number to be <=1" is now a
        // realistic reply — two anonymous complaints the model cannot act on.
        // A rejection it can't localise costs the whole proposal.
        const issue = formatZodIssues(parsed.error)
          .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
          .join("; ");
        return `Proposal was invalid and was NOT recorded: ${issue}. Fix it and call propose_decisions again.`;
      }
      proposal = parsed.data;
      return "Recorded.";
    },
    {
      name: "propose_decisions",
      description:
        "Propose the final set of planning decisions for this fact-finder import. " +
        "Validated against the planning decisions schema; an invalid proposal is " +
        "rejected with an explanation and NOT recorded — fix it and call again.",
      schema: z.object({
        decisions: z.unknown().describe("The proposed PlanningDecisions payload."),
      }),
    },
  );

  return {
    tools: [readDocument, listExtracted, estimateSsPia, proposeDecisions],
    getProposal: () => proposal,
  };
}
