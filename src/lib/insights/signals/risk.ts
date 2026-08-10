import { REVIEW_DUE_MONTHS } from "@/lib/risk/queries";
import { VERDICT_TOLERANCE_PCT } from "@/lib/insights/risk-capacity";
import type { Signal, SignalInput } from "./types";

export function riskSignals(input: SignalInput): Signal[] {
  const { risk, now, clientId } = input;
  const href = `/risk/${clientId}`;
  const out: Signal[] = [];

  const notEstablished = risk.toleranceScore === null;

  if (notEstablished) {
    out.push({
      id: "risk.no_profile",
      domain: "risk",
      severity: "watch",
      title: "No risk profile on file",
      detail:
        "No risk tolerance has been recorded, so the household has no suitability record. Send the questionnaire or set a rung by hand.",
      numbers: {},
      href,
      estimatedImpact: null,
    });
  } else if (risk.toleranceConfirmedAt) {
    // Same rule as deriveListFlags.reviewDue — 12 months from confirmation.
    const dueAfter = new Date(risk.toleranceConfirmedAt);
    dueAfter.setMonth(dueAfter.getMonth() + REVIEW_DUE_MONTHS);
    if (dueAfter <= now) {
      const monthsOld = Math.floor(
        (now.getTime() - risk.toleranceConfirmedAt.getTime()) / (30.44 * 86_400_000),
      );
      out.push({
        id: "risk.review_due",
        domain: "risk",
        severity: "watch",
        title: "Risk profile review is due",
        detail: `The recorded risk tolerance is about ${monthsOld} months old. Reconfirm it so the suitability record stays current.`,
        numbers: { monthsOld },
        href,
        estimatedImpact: null,
      });
    }
  }

  if (risk.mismatch.kind === "mismatch") {
    out.push({
      id: "risk.portfolio_off_target",
      domain: "risk",
      severity: "opportunity",
      title: "Plan is not invested at the profile's rung",
      detail: `The base scenario does not run on ${risk.mismatch.targetName}, the portfolio tagged for this household's risk level. Applying it is one click on the risk page.`,
      numbers: {},
      href,
      estimatedImpact: null,
    });
  }

  if (
    risk.toleranceScore !== null &&
    risk.alignment.requiredPct > risk.toleranceScore + VERDICT_TOLERANCE_PCT
  ) {
    const gap = risk.alignment.requiredPct - risk.toleranceScore;
    out.push({
      id: "risk.tolerance_below_required",
      domain: "risk",
      severity: "critical",
      title: "Goals demand more risk than the client will accept",
      detail: `The plan needs about ${risk.alignment.requiredPct}% growth exposure to fund its goals, but the household's recorded tolerance supports ${risk.toleranceScore}%. Saving more, working longer, or trimming goals closes the gap — taking more risk than tolerance supports does not.`,
      numbers: { requiredPct: risk.alignment.requiredPct, tolerance: risk.toleranceScore, gap },
      href,
      estimatedImpact: null,
    });
  }

  if (risk.bindingConstraint === "capacity") {
    out.push({
      id: "risk.capacity_binding",
      domain: "risk",
      severity: "watch",
      title: "Capacity is the binding constraint",
      detail:
        "The household is willing to take more risk than its plan can prudently absorb, so capacity — not tolerance — is setting the rung.",
      numbers: { capacityScore: risk.alignment.capacityScore },
      href,
      estimatedImpact: null,
    });
  }

  if (risk.alignment.verdict === "over_risked" || risk.alignment.verdict === "under_risked") {
    const over = risk.alignment.verdict === "over_risked";
    out.push({
      id: "risk.allocation_off",
      domain: "risk",
      severity: "watch",
      title: over ? "Portfolio carries more risk than capacity supports" : "Portfolio may be too conservative for the goals",
      detail: over
        ? `Current growth exposure is ${risk.alignment.currentPct}% against a capacity of ${risk.alignment.capacityPct}%.`
        : `Current growth exposure is ${risk.alignment.currentPct}% against the ${risk.alignment.requiredPct}% the goals require.`,
      numbers: {
        currentPct: risk.alignment.currentPct,
        capacityPct: risk.alignment.capacityPct,
        requiredPct: risk.alignment.requiredPct,
      },
      href,
      estimatedImpact: null,
    });
  }

  return out;
}
