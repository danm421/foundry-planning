import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent, TimelineEventDetail } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface RothFire {
  year: number;
  gross: number;
  taxable: number;
}

export function detectRothConversionEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const accountNameById = new Map<string, string>();
  for (const a of data.accounts ?? []) accountNameById.set(a.id, a.name);

  const planById = new Map<string, NonNullable<ClientData["rothConversions"]>[number]>();
  for (const plan of data.rothConversions ?? []) planById.set(plan.id, plan);

  // Group every year a conversion fires under its plan id so each conversion
  // renders as a single timeline card rather than one card per year. Projection
  // years are ascending, so the collected fires stay chronological and the first
  // fire is the earliest year.
  const firesByPlan = new Map<string, { name: string; fires: RothFire[] }>();
  for (const py of projection) {
    for (const fire of py.rothConversions ?? []) {
      let entry = firesByPlan.get(fire.id);
      if (!entry) {
        entry = { name: fire.name, fires: [] };
        firesByPlan.set(fire.id, entry);
      }
      entry.fires.push({ year: py.year, gross: fire.gross, taxable: fire.taxable });
    }
  }

  const out: TimelineEvent[] = [];
  for (const [planId, { name, fires }] of firesByPlan) {
    if (fires.length === 0) continue;
    const plan = planById.get(planId);
    const totalGross = fires.reduce((sum, f) => sum + f.gross, 0);

    // One row per fire year: "<year>" → "<gross>" (with the taxable portion
    // appended when it differs from the gross, e.g. backdoor conversions).
    const details: TimelineEventDetail[] = fires.map((f) => ({
      label: String(f.year),
      value:
        f.taxable === f.gross
          ? currency(f.gross)
          : `${currency(f.gross)} · ${currency(f.taxable)} taxable`,
    }));

    // Plan-level context, shown once beneath the per-year breakdown.
    if (plan?.destinationAccountId) {
      const destName = accountNameById.get(plan.destinationAccountId);
      if (destName) details.push({ label: "Destination Roth", value: destName });
    }
    if (plan && plan.sourceAccountIds && plan.sourceAccountIds.length > 0) {
      const sourceNames = plan.sourceAccountIds
        .map((id) => accountNameById.get(id) ?? id)
        .join(", ");
      details.push({ label: "Source accounts", value: sourceNames });
    }
    if (plan?.conversionType === "fill_up_bracket" && plan.fillUpBracket != null) {
      details.push({ label: "Fill-up bracket target", value: pct(plan.fillUpBracket) });
    }

    const first = fires[0];
    const supportingFigure =
      fires.length === 1
        ? first.taxable === first.gross
          ? `${currency(first.gross)} converted`
          : `${currency(first.gross)} converted · ${currency(first.taxable)} taxable`
        : `${currency(totalGross)} converted over ${fires.length} years`;

    out.push({
      id: `strategy:roth:${planId}`,
      year: first.year,
      category: "strategy",
      subject: "joint",
      title: name,
      supportingFigure,
      details,
    });
  }

  return out;
}
