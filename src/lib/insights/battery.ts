// src/lib/insights/battery.ts
import { db } from "@/db";
import { clients, crmHouseholds } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { fundingScore } from "@/lib/retirement/retirement-funding-score";
import { listHouseholdNotes } from "@/lib/crm/notes";
import { listTasks } from "@/lib/crm-tasks/queries";
import { loadCmaReturnBounds } from "./cma-bounds";
import { deriveInsightInputs, growthPctFromAllocation } from "./derive";
import { assembleRiskAlignment, type RiskAlignment } from "./risk-capacity";
import { computeNeedsAttention, type LintFinding } from "./lint";

export interface InsightsBattery {
  clientName: string;
  kpis: {
    netWorth: number;
    liquidPortfolio: number;
    yearsToRetirement: number | null;
    mcSuccessRate: number | null;
    fundingScore: number;
  };
  risk: RiskAlignment;
  needsAttention: LintFinding[];
  grounding: {
    goalsText: string;
    notesText: string;
    allocation: Array<{ group: string; pct: number }>;
  };
}

export async function loadInsightsBattery(
  clientId: string,
  firmId: string,
): Promise<InsightsBattery> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) throw new Error(`Client ${clientId} not found in firm`);

  const [household] = await db
    .select({ name: crmHouseholds.name, notes: crmHouseholds.notes })
    .from(crmHouseholds)
    .where(and(eq(crmHouseholds.id, client.crmHouseholdId), eq(crmHouseholds.firmId, firmId)));

  const overview = await getOverviewData(clientId, firmId, "base");
  const projection = overview.projection;

  // Current growth exposure from the household allocation rollup. Keep only
  // { group, pct } — the raw dollar `value` on Rollup would otherwise flow
  // into `grounding.allocation` and get hashed, flipping staleness on pure
  // market-value drift even when the allocation mix (pct) is unchanged.
  const allocation = overview.allocation.map((a) => ({ group: a.group, pct: a.pct }));
  const currentPct = growthPctFromAllocation(allocation);

  // Monte Carlo success (non-fatal).
  let mcSuccessRate: number | null = null;
  try {
    const mc = await getOrComputeMonteCarlo({ clientId, firmId, scenarioId: "base" });
    mcSuccessRate = mc.payload.summary.successRate;
  } catch (err) {
    console.error("[insights] monte carlo compute failed (non-fatal):", err);
  }

  const score = projection.length > 0 ? fundingScore(projection) : 1;
  const { cashReturn, equityReturn } = await loadCmaReturnBounds(firmId);

  const currentAge = projection[0]?.ages.client ?? client.retirementAge;
  const { capacity, required } = deriveInsightInputs({
    projection,
    currentAge,
    retirementAge: client.retirementAge,
    planEndAge: client.planEndAge,
    fundingScore: score,
    cashReturn,
    equityReturn,
  });
  const risk = assembleRiskAlignment({ currentPct, capacity, required });

  // CRM grounding + needs-attention.
  const notes = await listHouseholdNotes(client.crmHouseholdId, firmId);
  const notesText = notes.slice(0, 15).map((n) => n.body).join("\n");
  const tasks = await listTasks(firmId, { householdId: client.crmHouseholdId }, {
    status: null,
    overdueOnly: false,
    assigneeUserId: null,
  });
  const now = new Date();
  const overdueTaskCount = tasks.filter(
    (t) => t.status !== "done" && t.dueDate && new Date(t.dueDate) < now,
  ).length;
  const lastContactAt = notes[0]?.occurredAt ? new Date(notes[0].occurredAt) : null;
  const needsAttention = computeNeedsAttention(
    {
      overdueTaskCount,
      lastContactAt,
      // oldestAccountValuationAt deferred to a follow-up (no account-valuation-date
      // source wired yet); the stale_valuation lint branch is intentionally dormant in v1.
      oldestAccountValuationAt: null,
    },
    now,
  );

  return {
    clientName: household?.name ?? "Client",
    kpis: {
      netWorth: overview.kpi.netWorth,
      liquidPortfolio: overview.kpi.liquidPortfolio,
      yearsToRetirement: overview.kpi.yearsToRetirement,
      mcSuccessRate,
      fundingScore: score,
    },
    risk,
    needsAttention,
    grounding: {
      goalsText: household?.notes ?? "",
      notesText,
      allocation,
    },
  };
}
