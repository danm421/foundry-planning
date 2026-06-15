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
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { redactSsns } from "@/lib/extraction/redact-ssn";
import type { ClientData } from "@/engine/types";
import type { CopilotToolContext } from "../context";
import { assertClientReadable } from "../guards";
import { maskAccountNumber } from "../account-mask";

/** Detail kinds the model may request → the corresponding effective-tree slice. */
const DETAIL_KINDS = {
  account: (t: ClientData) => t.accounts ?? [],
  income: (t: ClientData) => t.incomes ?? [],
  expense: (t: ClientData) => t.expenses ?? [],
  liability: (t: ClientData) => t.liabilities ?? [],
  entity: (t: ClientData) => t.entities ?? [],
  gift: (t: ClientData) => t.gifts ?? [],
  family_member: (t: ClientData) => t.familyMembers ?? [],
  external_beneficiary: (t: ClientData) => t.externalBeneficiaries ?? [],
} satisfies Record<string, (t: ClientData) => unknown[]>;

type DetailKind = keyof typeof DETAIL_KINDS;

/** Account-number-bearing fields are masked to last-4 before the model sees them. */
const ACCOUNT_NUMBER_FIELDS = new Set(["accountNumber", "accountNumberRaw"]);

/**
 * Recursively sanitize a detail row before it leaves the server: redact SSNs
 * from every string, and collapse any account-number field to a masked
 * last-4 value (`accountNumber`). Walks arrays and nested objects so a leaked
 * SSN or raw account number anywhere in the row is caught.
 */
function sanitizeRow(value: unknown): unknown {
  if (typeof value === "string") return redactSsns(value).text;
  if (Array.isArray(value)) return value.map(sanitizeRow);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ACCOUNT_NUMBER_FIELDS.has(k)) {
        out.accountNumber = maskAccountNumber(v as string | null | undefined);
      } else {
        out[k] = sanitizeRow(v);
      }
    }
    return out;
  }
  return value;
}

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

  const readDetail = tool(
    async ({ clientId, kind }: { clientId: string; kind: DetailKind }) => {
      const firmId = await requireOrgId();
      await assertClientReadable(ctx, clientId);

      const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
      const rows = DETAIL_KINDS[kind](effectiveTree).map(sanitizeRow);

      return JSON.stringify({ kind, rows, count: rows.length });
    },
    {
      name: "read_detail",
      description:
        "Read the full base-case detail rows for one entity kind (accounts, incomes, expenses, liabilities, entities, gifts, family members, external beneficiaries). Account numbers are masked and SSNs redacted.",
      schema: z.object({
        clientId: z.string().describe("The client (household) id."),
        kind: z
          .enum([
            "account",
            "income",
            "expense",
            "liability",
            "entity",
            "gift",
            "family_member",
            "external_beneficiary",
          ])
          .describe("Which entity kind's detail rows to return."),
      }),
    },
  );

  return [findClient, clientBriefing, listScenarios, readDetail];
}
