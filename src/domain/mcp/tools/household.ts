import { z } from "zod";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadLifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import { loadDisabilityPolicies } from "@/lib/insurance-policies/load-disability-policies";
import type { ClientData, FamilyMember } from "@/engine/types";
import { defineTool, type McpTool } from "../define-tool";

/** Join a first/last name into a display string, or null when both are empty. */
function joinName(first?: string | null, last?: string | null): string | null {
  const joined = [first, last].filter((p) => p && p.trim()).join(" ").trim();
  return joined.length > 0 ? joined : null;
}

/**
 * R43: the spec gates exact dates of birth behind an admin-only firm flag
 * that defaults OFF, and Phase 1/2 always run in the strict redaction mode.
 * But the shared `sanitizeRow` (src/lib/redaction/sanitize-row.ts) only
 * redacts SSN-shaped strings and masks `accountNumber`/`accountNumberRaw`
 * keys — it does nothing to a date of birth, and `FamilyMember.dateOfBirth`
 * (engine/types.ts:367) is an exact calendar date. Of the eight
 * `DETAIL_KINDS` below, `family_member` is the only one whose underlying
 * engine type carries a birth-date-shaped field (Account, Income, Expense,
 * Liability, EntitySummary, Gift and the inline external-beneficiary type
 * were all checked and carry none).
 *
 * Fixed on the MCP path only, by reducing to a birth YEAR before the row
 * leaves the server — RMD and retirement-age questions need the year, not
 * the day. Shared `sanitizeRow` itself is untouched: Forge also calls it,
 * and Task 3 proved Forge's output byte-identical after the move, so
 * changing strict-mode behavior there would silently alter Forge's shipped
 * output too.
 *
 * String-sliced rather than `new Date(dateOfBirth).getFullYear()`: that
 * parses as UTC midnight and reads the year back in the server's local
 * time, which can roll a Jan 1 birthday back into the prior year depending
 * on timezone offset. Slicing the leading 4 characters of the stored
 * "YYYY-MM-DD" string is exact regardless of timezone.
 */
function redactFamilyMemberDob(fm: FamilyMember): Record<string, unknown> {
  const { dateOfBirth, ...rest } = fm;
  return { ...rest, birthYear: dateOfBirth ? Number(dateOfBirth.slice(0, 4)) : null };
}

/** Detail kinds a caller may request → the corresponding effective-tree slice. */
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

const getClientSummary = defineTool({
  name: "get_client_summary",
  title: "Household summary",
  description:
    "One-shot snapshot of a household: the client and spouse's names, net worth, liquid " +
    "portfolio, years to retirement, asset allocation, minimum projected net worth, upcoming " +
    "life events, open items and account count. Start here before any deeper question. Net " +
    "worth, liquid portfolio, years to retirement, allocation, open items and account count are " +
    "computed from current holdings and are always populated. When projectionAvailable is false, " +
    "the plan projection itself failed: minProjectedNetWorth comes back null and lifeEvents comes " +
    "back empty — say so rather than inferring values; the other fields are unaffected.",
  inputSchema: z.object({ clientId: z.string().describe("Household id from search_clients.") }),
  page: "overview",
  handler: async ({ clientId }, { firmId }) => {
    const [overview, client] = await Promise.all([
      getOverviewData(clientId, firmId, "base"),
      getClientWithContacts(clientId, firmId),
    ]);
    const projectionAvailable = overview.alertInputs.projectionError == null;
    return {
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
    };
  },
});

const getBalanceSheet = defineTool({
  name: "get_balance_sheet",
  title: "Balance sheet",
  description:
    "The household's accounts and liabilities, rolled up by category totals — no individual " +
    "account numbers appear in this output. accountsLessLiabilities is total account value minus " +
    "total liabilities; it is NOT the household's all-in net worth — it excludes business " +
    "entities held at a flat valuation and notes receivable. Use get_client_summary's netWorth " +
    "for the all-in household figure. For the individual rows behind a category, use " +
    "list_plan_details.",
  inputSchema: z.object({
    clientId: z.string().describe("Household id from search_clients."),
    scenarioId: z.string().optional().describe("Scenario id, or omit for the base case."),
  }),
  page: "balanceSheet",
  handler: async ({ clientId, scenarioId }, { firmId }) => {
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioId ?? "base", {});
    const accounts = (effectiveTree.accounts ?? []) as { name?: string; category?: string; value?: number }[];
    const liabilities = (effectiveTree.liabilities ?? []) as { name?: string; balance?: number }[];

    const byCategory = new Map<string, number>();
    for (const a of accounts) {
      const key = a.category ?? "other";
      byCategory.set(key, (byCategory.get(key) ?? 0) + (a.value ?? 0));
    }
    const totalAccountValue = accounts.reduce((s, a) => s + (a.value ?? 0), 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + (l.balance ?? 0), 0);

    return {
      scenarioId: scenarioId ?? "base",
      totalAccountValue,
      totalLiabilities,
      accountsLessLiabilities: totalAccountValue - totalLiabilities,
      assetsByCategory: [...byCategory].map(([category, value]) => ({ category, value })),
      liabilities: liabilities.map((l) => ({ name: l.name ?? null, balance: l.balance ?? 0 })),
      accountCount: accounts.length,
    };
  },
});

const listPlanDetails = defineTool({
  name: "list_plan_details",
  title: "List plan detail rows",
  description:
    "Read the individual rows behind one part of a household's plan: accounts, income, expenses, " +
    "liabilities, entities (trusts and businesses), gifts, family members, or external " +
    "beneficiaries. Goals are not a separate kind — they are expenses flagged isGoal, so request " +
    "kind 'expense' and filter on that flag. Every field is scanned for SSN-shaped text, which is " +
    "redacted, and an accountNumber field, where present, is masked to the last four digits. " +
    "family_member rows carry a birthYear instead of an exact date of birth. This can be large; " +
    "use limit and offset.",
  inputSchema: z.object({
    clientId: z.string().describe("Household id from search_clients."),
    kind: z
      .enum([
        "account", "income", "expense", "liability",
        "entity", "gift", "family_member", "external_beneficiary",
      ])
      .describe("Which kind of detail row to return."),
    scenarioId: z.string().optional().describe("Scenario id, or omit for the base case."),
    limit: z.number().int().positive().max(200).optional().describe("Default 50, max 200."),
    offset: z.number().int().nonnegative().optional(),
  }),
  page: "netWorth",
  handler: async ({ clientId, kind, scenarioId, limit, offset }, { firmId }) => {
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioId ?? "base", {});
    const all = DETAIL_KINDS[kind](effectiveTree);
    const start = offset ?? 0;
    const sliced = all.slice(start, start + (limit ?? 50));
    // R43: family_member is the only kind carrying a birth-date-shaped
    // field; see redactFamilyMemberDob for why and how.
    const rows =
      kind === "family_member"
        ? sliced.map((r) => redactFamilyMemberDob(r as FamilyMember))
        : sliced;
    return {
      kind,
      scenarioId: scenarioId ?? "base",
      rows,
      count: rows.length,
      totalCount: all.length,
    };
  },
});

const getInsurance = defineTool({
  name: "get_insurance",
  title: "Insurance coverage",
  description:
    "The household's life insurance policies (type, owner, insured, death benefit, cash value, " +
    "premium, term expiry, beneficiaries) and disability policies. Both are read from the " +
    "household's base data, not any what-if scenario — this tool takes no scenarioId.",
  inputSchema: z.object({
    clientId: z.string().describe("Household id from search_clients."),
  }),
  page: "insurance",
  handler: async ({ clientId }, { firmId }) => {
    const client = await getClientWithContacts(clientId, firmId);
    const primaryName = joinName(client?.firstName, client?.lastName) ?? "Client";
    const spouseName = joinName(client?.spouseFirstName, client?.spouseLastName);
    // NOTE: loadDisabilityPolicies takes no firmId and trusts its caller.
    // defineTool has already run assertClientReadableForPrincipal by here.
    const [life, disability] = await Promise.all([
      loadLifeInsuranceInventory(clientId, firmId, primaryName, spouseName),
      loadDisabilityPolicies(clientId),
    ]);
    return {
      lifePolicies: life.policies,
      lifePolicyCount: life.policies.length,
      disabilityPolicies: disability,
      disabilityPolicyCount: disability.length,
    };
  },
});

export const householdTools: McpTool[] = [
  getClientSummary,
  getBalanceSheet,
  listPlanDetails,
  getInsurance,
];
