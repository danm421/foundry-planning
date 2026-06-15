// src/domain/copilot/tools/read.ts
//
// Phase 1 read tools for the copilot. Every client-scoped tool re-derives the
// firmId server-side via `requireOrgId()` (the model never supplies scope) and
// awaits `assertClientReadable` before touching any client data, so a
// model-echoed clientId can never widen scope. `find_client` is the lone
// exception: it's firm-scoped through `searchClients`, with no single-client
// guard.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { requireOrgId } from "@/lib/db-helpers";
import { searchClients } from "@/lib/client-search";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import type { CopilotToolContext } from "../context";
import { assertClientReadable } from "../guards";

/** Join a first/last name into a display string, or null when both are empty. */
function joinName(
  first: string | null | undefined,
  last: string | null | undefined,
): string | null {
  const joined = [first, last].filter((p) => p && p.trim()).join(" ").trim();
  return joined.length > 0 ? joined : null;
}

export function buildReadTools(
  toolCtx: CopilotToolContext,
): StructuredToolInterface[] {
  const { ctx } = toolCtx;

  const findClient = tool(
    async ({ query }: { query: string }) => {
      const firmId = await requireOrgId();
      const rows = await searchClients(query, firmId);
      return JSON.stringify(rows);
    },
    {
      name: "find_client",
      description:
        "Search the advisor's client roster by free-text name. Returns matching households (id + title) scoped to the current firm.",
      schema: z.object({
        query: z.string().describe("Free-text name fragment to search for."),
      }),
    },
  );

  const clientBriefing = tool(
    async ({ clientId }: { clientId: string }) => {
      const firmId = await requireOrgId();
      await assertClientReadable(ctx, clientId);

      const [overview, client] = await Promise.all([
        getOverviewData(clientId, firmId, "base"),
        getClientWithContacts(clientId, firmId),
      ]);

      const projectionAvailable = overview.alertInputs.projectionError == null;

      return JSON.stringify({
        identity: {
          primaryName: joinName(client?.firstName, client?.lastName),
          spouseName: joinName(client?.spouseFirstName, client?.spouseLastName),
        },
        netWorth: overview.kpi.netWorth,
        liquidPortfolio: overview.kpi.liquidPortfolio,
        yearsToRetirement: overview.kpi.yearsToRetirement,
        minProjectedNetWorth: projectionAvailable ? overview.runway.minNetWorth : null,
        allocation: overview.allocation,
        lifeEvents: projectionAvailable ? overview.lifeEvents : [],
        openItemCount: overview.totalOpen,
        openItemsPreview: overview.openItemsPreview,
        accountCount: overview.accountCount,
        projectionAvailable,
      });
    },
    {
      name: "client_briefing",
      description:
        "Grounded one-shot snapshot of a client: identity, net worth, liquid portfolio, years to retirement, allocation, life events, open items, and account count. Projection-derived fields are suppressed when the projection failed.",
      schema: z.object({
        clientId: z.string().describe("The client (household) id to brief."),
      }),
    },
  );

  return [findClient, clientBriefing];
}
