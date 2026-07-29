import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { planSettings } from "@/db/schema";
import { requireClientAccess } from "@/lib/clients/authz";
import { getOrComputeCapacity, type CapacityResult } from "@/lib/risk/capacity";
import { getRiskProfileDetail } from "@/lib/risk/queries";
import { band, type BindingConstraint } from "@/lib/risk/scoring";
import { resolveScenarioId } from "@/lib/compute-cache/resolve-scenario-id";
import { resolveRiskPortfolioId } from "@/lib/cma/resolve-risk-portfolio";
import {
  describeMismatch,
  effectiveScenarioPortfolioId,
  type MismatchState,
} from "@/lib/risk/portfolio-mismatch";
import { RiskLevelBadge } from "@/components/risk/risk-level-badge";
import { CHIP_NEUTRAL } from "@/components/risk/risk-status-chips";
import { ComponentCard } from "@/components/risk/component-card";
import { CapacityBreakdown } from "@/components/risk/capacity-breakdown";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { RiskHistoryTable } from "@/components/risk/risk-history-table";
import { ManualToleranceDialog } from "@/components/risk/manual-tolerance-dialog";
import { EnvironmentEditor } from "@/components/risk/environment-editor";
import { RtqDialog } from "@/components/risk/rtq-dialog";
import { SendRtqDialog } from "@/components/risk/send-rtq-dialog";
import { PortfolioMismatch } from "@/components/risk/portfolio-mismatch";

const TOLERANCE_SOURCE_LABELS: Record<string, string> = {
  rtq_client: "Client RTQ",
  rtq_advisor: "Advisor RTQ",
  manual: "Manual",
};

const SUBJECT_LABELS: Record<"primary" | "spouse", string> = {
  primary: "Primary",
  spouse: "Spouse",
};

const DASH = <span className="text-ink-3">—</span>;

// Every mutation surface on this page is wired up in Tasks 10-13: "Set
// manually" and environment "Edit" as of Task 10, "Fill out now" as of Task
// 11, "Send questionnaire" as of Task 13.

function formatDate(d: Date | null): ReactNode {
  return d ? <span className="tabular">{new Date(d).toISOString().slice(0, 10)}</span> : DASH;
}

function bindingConstraintLine(binding: BindingConstraint): string {
  if (binding === "capacity") return "Capacity is the binding constraint";
  if (binding === "tolerance") return "Tolerance is the binding constraint";
  return "No capacity yet - profile is provisional";
}

function formatAdjustment(adj: number): string {
  if (adj > 0) return `+${adj}`;
  return String(adj);
}

export async function RiskDetailContent({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const { firmId } = await requireClientAccess(clientId);

  // A household with no plan throws here -- that is the capacityPending
  // state below, not an error page.
  let capacity: CapacityResult | null = null;
  try {
    capacity = await getOrComputeCapacity({ clientId, firmId });
  } catch {
    capacity = null;
  }

  // Read AFTER getOrComputeCapacity so the row reflects whatever that call
  // just recomputed and wrote.
  const { row, flags, events, unreviewedNotes, pendingRtqs, contacts } =
    await getRiskProfileDetail(clientId);

  // A household with no base scenario / plan settings throws inside
  // resolveScenarioId -- same "not an error page" treatment as the capacity
  // guard above. Falling back to `no_profile` renders nothing rather than
  // crashing a page that works fine for a planless household today.
  let mismatch: MismatchState = { kind: "no_profile" };
  if (row.compositeLevel) {
    try {
      const baseScenarioId = await resolveScenarioId(clientId, "base");
      const [settings] = await db
        .select({
          growthSourceTaxable: planSettings.growthSourceTaxable,
          growthSourceRetirement: planSettings.growthSourceRetirement,
          modelPortfolioIdTaxable: planSettings.modelPortfolioIdTaxable,
          modelPortfolioIdRetirement: planSettings.modelPortfolioIdRetirement,
        })
        .from(planSettings)
        .where(eq(planSettings.scenarioId, baseScenarioId));
      const profilePortfolioId = await resolveRiskPortfolioId(firmId, row.compositeLevel);
      mismatch = describeMismatch({
        compositeLevel: row.compositeLevel,
        profilePortfolioId,
        scenarioPortfolioId: effectiveScenarioPortfolioId(settings ?? null),
      });
    } catch {
      mismatch = { kind: "no_profile" };
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">{row.householdName}</h1>
          <RiskLevelBadge level={row.compositeLevel} score={row.compositeScore} />
        </div>
        <p className="mt-1 text-sm text-ink-2">{bindingConstraintLine(row.bindingConstraint)}</p>
        <p className="mt-0.5 text-xs text-ink-3">Last updated {formatDate(row.updatedAt)}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ComponentCard title="Tolerance">
          {row.toleranceScore === null ? (
            <p className="text-sm text-ink-3">Not established</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="tabular text-2xl font-semibold text-ink">
                  {row.toleranceScore}
                </span>
                {flags.reviewDue && (
                  // Same classification as the list page's RiskStatusChips: a
                  // routine 12-month reminder is neutral, not a warning --
                  // WARN is reserved for capacityConstrained/goalsOverReaching.
                  <span className={`chip ${CHIP_NEUTRAL}`}>Review due</span>
                )}
              </div>
              <p className="text-xs text-ink-3">
                {TOLERANCE_SOURCE_LABELS[row.toleranceSource ?? ""] ?? "—"}
                {" · "}
                {formatDate(row.toleranceConfirmedAt)}
              </p>
              {row.spouseToleranceScore !== null && (
                <p className="text-xs text-ink-3">
                  Spouse <span className="tabular text-ink-2">{row.spouseToleranceScore}</span> —
                  household tolerance uses the lower of the two
                </p>
              )}
            </>
          )}
          {pendingRtqs.length > 0 && (
            <ul className="space-y-0.5">
              {pendingRtqs.map((p) => (
                <li key={p.subject} className="text-xs text-ink-3">
                  {SUBJECT_LABELS[p.subject]} questionnaire sent {formatDate(p.sentAt)}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <SendRtqDialog
              clientId={clientId}
              hasSpouse={contacts.spouse !== null}
              contacts={contacts}
            />
            <RtqDialog clientId={clientId} />
            <ManualToleranceDialog
              clientId={clientId}
              currentLevel={row.toleranceScore !== null ? band(row.toleranceScore) : null}
            />
          </div>
        </ComponentCard>

        <ComponentCard
          title="Capacity"
          footer={
            capacity && row.capacityComputedAt
              ? `Computed from the base scenario on ${new Date(row.capacityComputedAt).toISOString().slice(0, 10)}`
              : undefined
          }
        >
          {capacity ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="tabular text-2xl font-semibold text-ink">{row.capacityScore}</span>
                <FieldTooltip text="The four factors below add up to 120 at most, and the total is capped at 100. That headroom lets real strength in one area cover a gap in another — a large portfolio with decades of horizon can reach 100 with no Social Security at all." />
              </span>
              <CapacityBreakdown factors={capacity.factors} />
            </>
          ) : (
            <p className="text-sm text-ink-3">No plan yet - build a plan to establish capacity</p>
          )}
        </ComponentCard>

        <ComponentCard title="Environment">
          <span className="tabular text-2xl font-semibold text-ink">
            {formatAdjustment(row.environmentAdj)}
          </span>
          <p className="text-sm text-ink-2">{row.environmentReason ?? DASH}</p>
          <div className="pt-1">
            <EnvironmentEditor
              clientId={clientId}
              adjustment={row.environmentAdj}
              reason={row.environmentReason}
            />
          </div>
        </ComponentCard>
      </div>

      <PortfolioMismatch clientId={clientId} state={mismatch} />

      {unreviewedNotes.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-4">
          <p className="text-sm font-medium text-warn">
            A client described their circumstances. Review and set the environment adjustment.
          </p>
          <ul className="mt-3 space-y-3">
            {unreviewedNotes.map((n) => (
              <li key={n.id} className="text-sm text-ink-2">
                <p className="whitespace-pre-wrap">{n.note}</p>
                <p className="mt-0.5 text-xs text-ink-3">Submitted {formatDate(n.submittedAt)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {flags.goalsOverReaching && row.requiredGrowthPct !== null && row.capacityScore !== null && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-4">
          <p className="text-sm text-warn">
            Funding these goals needs {row.requiredGrowthPct}% growth exposure, above this
            household&apos;s capacity of {row.capacityScore}. The plan needs to change, not the
            portfolio.
          </p>
        </div>
      )}

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">History</h2>
        <div className="mt-2">
          <RiskHistoryTable events={events} />
        </div>
      </div>
    </div>
  );
}
