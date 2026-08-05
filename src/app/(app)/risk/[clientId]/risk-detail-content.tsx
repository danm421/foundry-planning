import type { ReactNode } from "react";
import { requireClientAccess } from "@/lib/clients/authz";
import { getOrComputeCapacity, type CapacityResult } from "@/lib/risk/capacity";
import { getRiskProfileDetail } from "@/lib/risk/queries";
import { band } from "@/lib/risk/scoring";
import { resolveMismatchState } from "@/lib/risk/detail-mismatch";
import {
  TOLERANCE_SOURCE_LABELS,
  bindingConstraintLine,
  formatAdjustment,
} from "@/lib/risk/labels";
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
import { RiskPdfButton } from "@/components/risk/risk-pdf-button";

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

  const mismatch = await resolveMismatchState({
    clientId,
    firmId,
    compositeLevel: row.compositeLevel,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-ink">{row.householdName}</h1>
            <RiskLevelBadge level={row.compositeLevel} score={row.compositeScore} />
          </div>
          <p className="mt-1 text-sm text-ink-2">{bindingConstraintLine(row.bindingConstraint)}</p>
          <p className="mt-0.5 text-xs text-ink-3">Last updated {formatDate(row.updatedAt)}</p>
        </div>
        <RiskPdfButton clientId={clientId} householdName={row.householdName} />
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
                <FieldTooltip text="The five factors below add up to 143 at most, and the total is capped at 100. That headroom lets real strength in one area cover a gap in another. There are two routes to high capacity and either one is enough on its own: decades before the portfolio is touched, or guaranteed income that already covers the spending. The other three factors support those two rather than substituting for them." />
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
