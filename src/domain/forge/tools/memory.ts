// Cross-conversation long-term memory tools over the PostgresStore. read_memory
// recalls durable client facts / advisor prefs; write_memory saves them.
// write_memory is intentionally NOT in WRITE_TOOL_NAMES — it stores
// non-destructive preference data, not plan facts, so it doesn't route through
// the approval gate; instead each save is capped in size and logged. Namespacing
// is server-derived from the tool context; the model never supplies
// firm/client/user scope.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { recordAudit } from "@/lib/audit";
import { getStore } from "../store";
import { MEMORY_KEY_MAX, MEMORY_VALUE_MAX } from "../system-prompt";
import type { ForgeToolContext, ForgeAuthContext } from "../context";

function namespace(ctx: ForgeAuthContext, scope: "client" | "advisor"): string[] {
  return scope === "client" ? [ctx.firmId, ctx.clientId] : [ctx.firmId, ctx.userId];
}

export function buildMemoryTools({ ctx, conversationId }: ForgeToolContext): StructuredToolInterface[] {
  const read = tool(
    async ({ scope, query }: { scope: "client" | "advisor"; query: string }) => {
      const items = await getStore().search(namespace(ctx, scope), { query });
      return JSON.stringify(items ?? []);
    },
    {
      name: "read_memory",
      description:
        "Recall durable facts/preferences you previously saved for this client (scope:'client') or this advisor (scope:'advisor'). Consult before asking the user something you may already know.",
      schema: z.object({
        scope: z.enum(["client", "advisor"]),
        query: z.string().describe("What to recall, e.g. 'risk tolerance'"),
      }),
    },
  );

  const write = tool(
    async ({ scope, key, value }: { scope: "client" | "advisor"; key: string; value: string }) => {
      await getStore().put(namespace(ctx, scope), key, {
        value,
        updatedAt: new Date().toISOString(),
      });
      // No approval card shows this save, so the log records it: where it came
      // from and how big it is, not the note's text.
      await recordAudit({
        action: "forge.tool_call",
        resourceType: "forge_memory",
        resourceId: key,
        firmId: ctx.firmId,
        clientId: ctx.clientId,
        actorId: ctx.userId,
        metadata: { tool: "write_memory", conversationId, scope, key, valueLength: value.length },
      });
      return `Saved ${scope} memory '${key}'.`;
    },
    {
      name: "write_memory",
      description:
        "Save a durable, non-sensitive preference or recurring assumption — client-level (scope:'client', e.g. 'prefers conservative projections') or advisor-level (scope:'advisor', e.g. communication style). Do NOT store plan facts here; use the plan tools for those.",
      schema: z.object({
        scope: z.enum(["client", "advisor"]),
        key: z.string().min(1).max(MEMORY_KEY_MAX).describe("A short label, e.g. 'risk_tolerance'"),
        value: z.string().min(1).max(MEMORY_VALUE_MAX).describe("The preference in a sentence or two"),
      }),
    },
  );

  return [read, write];
}
