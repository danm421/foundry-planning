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
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { searchClients } from "@/lib/client-search";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
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

  const listScenarios = tool(
    async ({ clientId, scenarioId }: { clientId: string; scenarioId?: string }) => {
      const firmId = await requireOrgId();
      await assertClientReadable(ctx, clientId);

      const list = await db
        .select({
          id: scenarios.id,
          name: scenarios.name,
          isBaseCase: scenarios.isBaseCase,
        })
        .from(scenarios)
        .where(eq(scenarios.clientId, clientId));

      // No drill requested → just the roster.
      if (!scenarioId) return JSON.stringify({ scenarios: list });

      // Drill requested for an id that isn't in this client's roster → no detail.
      if (!list.some((s) => s.id === scenarioId)) {
        return JSON.stringify({
          scenarios: list,
          detail: null,
          note: `scenario ${scenarioId} is not in this client's roster`,
        });
      }

      // loadPanelData returns null for the base case (nothing to revert) or a
      // missing client — surface the roster with no detail rather than erroring.
      const panel = await loadPanelData(clientId, scenarioId, firmId);
      if (panel == null) {
        return JSON.stringify({
          scenarios: list,
          detail: null,
          note: `scenario ${scenarioId} has no change detail (base case or unavailable)`,
        });
      }

      return JSON.stringify({
        scenarios: list,
        detail: {
          scenarioId: panel.scenarioId,
          changes: panel.changes,
          toggleGroups: panel.toggleGroups,
        },
      });
    },
    {
      name: "list_scenarios",
      description:
        "List a client's scenarios (id, name, isBaseCase). Pass a scenarioId to drill into that scenario's changes and toggle groups.",
      schema: z.object({
        clientId: z.string().describe("The client (household) id."),
        scenarioId: z
          .string()
          .optional()
          .describe("Optional scenario id to drill into for change detail."),
      }),
    },
  );

  return [findClient, clientBriefing, listScenarios];
}
