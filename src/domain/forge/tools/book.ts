// src/domain/forge/tools/book.ts
//
// Book-level scan: a read-only query across the advisor's OWN clients
// (firmId = requireOrgId(), advisorId = ctx.userId — never model-supplied).
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { requireOrgId } from "@/lib/db-helpers";
import { scanBook } from "@/lib/book-scan/scan";
import type { ForgeToolContext } from "../context";

const filtersSchema = z
  .object({
    lastContactDaysOver: z.number().int().nonnegative().optional(),
    lastContactDaysUnder: z.number().int().nonnegative().optional(),
    cashAtLeast: z.number().nonnegative().optional(),
    liquidAtLeast: z.number().nonnegative().optional(),
    netWorthUnder: z.number().optional(),
    hasPendingImport: z.boolean().optional(),
    hasOpenItems: z.boolean().optional(),
    minOpenTasks: z.number().int().nonnegative().optional(),
  })
  .optional();

export function buildBookTools(toolCtx: ForgeToolContext): StructuredToolInterface[] {
  const { ctx } = toolCtx;

  const scanBookTool = tool(
    async (opts: {
      sortBy?: "netWorth" | "liquid" | "cashBalance" | "lastContactDays" | "openTasks" | "openItems";
      direction?: "asc" | "desc";
      filters?: z.infer<typeof filtersSchema>;
      limit?: number;
      offset?: number;
    }) => {
      const firmId = await requireOrgId();
      const result = await scanBook({ firmId, advisorId: ctx.userId }, opts);
      return JSON.stringify(result);
    },
    {
      name: "scan_book",
      description:
        "Scan across the advisor's own clients for relationship and portfolio signals — who hasn't been contacted recently, who holds the most idle cash, who has open items or a pending document import. Returns a ranked, capped list of clients with their figures plus a total count. Use it for 'my clients' / 'which clients…' questions.",
      schema: z.object({
        sortBy: z
          .enum(["netWorth", "liquid", "cashBalance", "lastContactDays", "openTasks", "openItems"])
          .optional()
          .describe("Signal to rank by. Default lastContactDays."),
        direction: z.enum(["asc", "desc"]).optional().describe("Sort direction. Default desc."),
        filters: filtersSchema.describe("Optional filters, all AND-ed."),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 25, hard cap 200)."),
        offset: z.number().int().min(0).optional().describe("Pagination offset."),
      }),
    },
  );

  return [scanBookTool];
}
