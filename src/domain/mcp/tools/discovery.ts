import { z } from "zod";
import { searchHouseholds } from "@/lib/client-search";
import { scanBook, SIGNAL_KEYS, DEFAULT_LIMIT, MAX_LIMIT } from "@/lib/book-scan/scan";
import { defineTool, type McpTool } from "../define-tool";

const searchClientsTool = defineTool({
  name: "search_clients",
  title: "Search households",
  description:
    "Search the households this advisor may see — their own book, or the firm's whole book if " +
    "their role allows it — by free-text name, and return matching households. A household is " +
    "one client record and may include a spouse. Call this first to turn a name into the ids " +
    "every other Foundry tool needs. Each result carries householdId (always) and clientId " +
    "(only when a financial plan exists). PROSPECTS come back with hasPlan: false and clientId " +
    "null — the notes tools work on them, and every planning tool will refuse them. Returns at " +
    "most 8 matches.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Name fragment to search for, e.g. 'mueller'."),
  }),
  handler: async ({ query }, { principal, firmId }) => {
    const rows = await searchHouseholds(query, firmId, {
      userId: principal.userId,
      orgRole: principal.orgRole,
    });
    // Already projected to ids + title + hasPlan by searchHouseholds; no
    // contact name or email is selected at all, so none can leak.
    return { households: rows };
  },
});

const scanBookTool = defineTool({
  name: "scan_book",
  title: "Scan the book for planning signals",
  description:
    "Scan the advisor's own households — the ones assigned to them, not the whole firm's book — for " +
    "planning signals: net worth, liquid assets, uninvested cash, days since last contact, open " +
    "tasks, open data-collection items, and pending imports. " +
    `Capped at ${MAX_LIMIT} rows per call; the response's truncated and totalCount fields say ` +
    "whether more exist. Use this to answer 'who should I be calling' or 'who is sitting on excess " +
    "cash'. Returns a ranked table, not full household detail.",
  inputSchema: z.object({
    sortBy: z.enum(SIGNAL_KEYS).optional().describe("Signal to rank by."),
    direction: z.enum(["asc", "desc"]).optional(),
    filters: z
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
      .optional(),
    limit: z.number().int().positive().optional().describe(`Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
    offset: z.number().int().nonnegative().optional(),
  }),
  handler: async (args, { principal, firmId }) => {
    const result = await scanBook(
      { firmId, advisorId: principal.userId },
      {
        sortBy: args.sortBy,
        direction: args.direction,
        filters: args.filters,
        limit: Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
        offset: args.offset,
      },
    );
    return result;
  },
});

export const discoveryTools: McpTool[] = [searchClientsTool, scanBookTool];
