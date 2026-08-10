// src/lib/insights/battery.ts
import { db } from "@/db";
import { clientRiskProfiles, clients, crmHouseholds } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { fundingScore } from "@/lib/retirement/retirement-funding-score";
import { listHouseholdNotes } from "@/lib/crm/notes";
import { listTasks } from "@/lib/crm-tasks/queries";
import { resolveMismatchState } from "@/lib/risk/detail-mismatch";
import { getLatestTaxReturn } from "@/lib/tax-returns/store";
import { assembleTaxAnalysis } from "@/lib/tax-returns/assemble-analysis";
import { loadCmaReturnBounds } from "./cma-bounds";
import { deriveInsightInputs, growthPctFromAllocation } from "./derive";
import { assembleRiskAlignment, type RiskAlignment } from "./risk-capacity";
import { largestPosition } from "./largest-position";
import { buildSignals } from "./signals";
import type { Signal, SignalInput } from "./signals";
import type { PersonRetirementFacts } from "@/lib/retirement/retirement-facts";

export interface InsightsBattery {
  clientName: string;
  kpis: {
    netWorth: number;
    liquidPortfolio: number;
    yearsToRetirement: number | null;
    mcSuccessRate: number | null;
    fundingScore: number;
  };
  /** Plan-authoritative retirement age + year per person. */
  retirementPeople: PersonRetirementFacts[];
  risk: RiskAlignment;
  /**
   * Recorded risk-tolerance rung, on the same 0–100 growth-exposure axis as
   * `risk`; null when no risk profile is on file. Surfaced separately from
   * `risk` because `RiskAlignment` is derived purely from planning data and
   * knows nothing about the RTQ — the 360's alignment scale plots this as a
   * fourth marker.
   *
   * Deliberately NOT in `hashBattery`'s material: a tolerance change that
   * matters already moves the hash through `signals` (risk.no_profile,
   * risk.tolerance_below_required), so hashing it again would only invalidate
   * every persisted profile for no behavioural gain.
   */
  toleranceScore: number | null;
  signals: Signal[];
  /** Ending-portfolio percentile bands. Already in the MC payload the battery
   *  pays for; reading them next to successRate costs nothing. */
  mcBands: { p5: number; p50: number; p95: number } | null;
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
  let mcBands: InsightsBattery["mcBands"] = null;
  try {
    const mc = await getOrComputeMonteCarlo({ clientId, firmId, scenarioId: "base" });
    mcSuccessRate = mc.payload.summary.successRate;
    const e = mc.payload.summary.ending;
    mcBands = { p5: e.p5, p50: e.p50, p95: e.p95 };
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

  // CRM grounding + relationship signal inputs.
  const notes = await listHouseholdNotes(client.crmHouseholdId, firmId);
  // Date + title each note. Bare bodies made a years-old discovery note read as
  // current — that is how "both want to retire around Cooper's 60th birthday"
  // ended up stated as the plan's timeline. Dates let the model age-weight them.
  const notesText = notes
    .slice(0, 15)
    .map((n) => `[${n.occurredAt.slice(0, 10)}] ${n.kind} — ${n.title}: ${n.body}`)
    .join("\n");
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

  // Risk profile. Direct select, NOT getRiskProfileDetail — that helper calls
  // requireClientAccess internally and the route has already authorized.
  const [riskProfile] = await db
    .select({
      toleranceScore: clientRiskProfiles.toleranceScore,
      toleranceConfirmedAt: clientRiskProfiles.toleranceConfirmedAt,
      compositeLevel: clientRiskProfiles.compositeLevel,
      bindingConstraint: clientRiskProfiles.bindingConstraint,
    })
    .from(clientRiskProfiles)
    .where(
      and(
        eq(clientRiskProfiles.clientId, clientId),
        eq(clientRiskProfiles.firmId, firmId),
      ),
    );

  const [mismatch, taxBundle, largest] = await Promise.all([
    resolveMismatchState({
      clientId,
      firmId,
      compositeLevel: riskProfile?.compositeLevel ?? null,
    }),
    loadTaxObservations(clientId),
    largestPosition(clientId),
  ]);

  const cashPct = allocation
    .filter((a) => a.group === "cash")
    .reduce((s, a) => s + a.pct, 0);
  // The rollup's own dollar base. `pct` above is a share of THIS, not of
  // `liquidPortfolio` — getAssetAllocationByType starts FROM
  // account_asset_allocations, so only accounts with an asset mix on file are
  // in it, while liquidPortfolio sums every account bar real estate, business
  // and life insurance. Any cash-dollar figure has to be taken against this.
  const allocatedTotal = overview.allocation.reduce((s, a) => s + a.value, 0);

  const signalInput: SignalInput = {
    clientId,
    now,
    risk: {
      alignment: risk,
      toleranceScore: riskProfile?.toleranceScore ?? null,
      toleranceConfirmedAt: riskProfile?.toleranceConfirmedAt ?? null,
      compositeLevel: riskProfile?.compositeLevel ?? null,
      bindingConstraint: riskProfile?.bindingConstraint ?? "none",
      mismatch,
    },
    plan: {
      mcSuccessRate,
      liquidPortfolio: overview.kpi.liquidPortfolio,
      currentYearNetOutflow: overview.alertInputs.currentYearNetOutflow,
      minNetWorth: overview.alertInputs.minNetWorth,
      fundingScore: score,
      hasProjection: projection.length > 0,
    },
    portfolio: {
      cashPct,
      allocatedTotal,
      cashReturn,
      equityReturn,
      largestPosition: largest,
    },
    relationship: {
      crmHouseholdId: client.crmHouseholdId,
      overdueTaskCount,
      lastContactAt,
      portalInvitedAt: client.portalInvitedAt,
      portalFirstLoginAt: client.portalFirstLoginAt,
      lifeEvents: overview.lifeEvents,
      // planStartYear lives on plan_settings, NOT on the clients row. The
      // projection's first year IS it by construction (the engine loops
      // `for (let year = planSettings.planStartYear; ...)`), and the
      // projection is already loaded. A 0 fallback is safe: an empty
      // projection also yields no lifeEvents, so the rule cannot fire.
      planStartYear: projection[0]?.year ?? 0,
    },
    tax: taxBundle,
  };
  const signals = buildSignals(signalInput);

  return {
    clientName: household?.name ?? "Client",
    kpis: {
      netWorth: overview.kpi.netWorth,
      liquidPortfolio: overview.kpi.liquidPortfolio,
      yearsToRetirement: overview.kpi.yearsToRetirement,
      mcSuccessRate,
      fundingScore: score,
    },
    retirementPeople: overview.retirementPeople,
    risk,
    toleranceScore: riskProfile?.toleranceScore ?? null,
    signals,
    mcBands,
    grounding: {
      goalsText: household?.notes ?? "",
      notesText,
      allocation,
    },
  };
}

/** Latest filed return's observations, or an empty bundle when none is on file. */
async function loadTaxObservations(
  clientId: string,
): Promise<SignalInput["tax"]> {
  try {
    const latest = await getLatestTaxReturn(clientId);
    if (!latest) return { observations: [], taxYear: null };
    const assembled = await assembleTaxAnalysis(clientId, latest.taxYear);
    return {
      observations: assembled?.analysis?.observations ?? [],
      taxYear: latest.taxYear,
    };
  } catch (err) {
    // A household with no tax data must not break the whole 360.
    console.error("[insights] tax analysis failed (non-fatal):", err);
    return { observations: [], taxYear: null };
  }
}
