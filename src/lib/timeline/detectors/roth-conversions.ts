import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent, TimelineEventDetail } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function detectRothConversionEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const accountNameById = new Map<string, string>();
  for (const a of data.accounts ?? []) accountNameById.set(a.id, a.name);

  const planById = new Map<string, NonNullable<ClientData["rothConversions"]>[number]>();
  for (const plan of data.rothConversions ?? []) planById.set(plan.id, plan);

  for (const py of projection) {
    for (const fire of py.rothConversions ?? []) {
      const plan = planById.get(fire.id);
      const taxablePct = fire.gross > 0 ? fire.taxable / fire.gross : 0;
      const details: TimelineEventDetail[] = [
        { label: "Gross converted", value: currency(fire.gross) },
        { label: "Taxable amount", value: currency(fire.taxable) },
        { label: "% taxable", value: pct(taxablePct) },
      ];
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

      out.push({
        id: `strategy:roth:${fire.id}:${py.year}`,
        year: py.year,
        category: "strategy",
        subject: "joint",
        title: fire.name,
        supportingFigure: `${currency(fire.gross)} converted · ${currency(fire.taxable)} taxable`,
        details,
      });
    }
  }

  return out;
}
