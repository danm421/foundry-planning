import type { ClientData, ProjectionYear, Income } from "@/engine";
import type { TimelineEvent, TimelineSubject } from "../timeline-types";

function subjectFor(owner: Income["owner"]): TimelineSubject {
  if (owner === "client") return "primary";
  if (owner === "spouse") return "spouse";
  return "joint";
}

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

export function detectIncomeEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  for (const inc of data.incomes) {
    const subject = subjectFor(inc.owner);

    if (inc.type === "salary") {
      if (inRange(inc.startYear, projection)) {
        out.push({
          id: `income:salary_start:${subject}:${inc.id}`,
          year: inc.startYear,
          category: "income",
          subject,
          title: `${inc.name} begins`,
          supportingFigure: `${currency(inc.annualAmount)}/yr`,
          details: [{ label: "Annual", value: currency(inc.annualAmount) }],
        });
      }
      if (inRange(inc.endYear, projection)) {
        out.push({
          id: `income:salary_stop:${subject}:${inc.id}`,
          year: inc.endYear,
          category: "income",
          subject,
          title: `${inc.name} ends`,
          supportingFigure: `${currency(inc.annualAmount)}/yr ends`,
          details: [{ label: "Final annual", value: currency(inc.annualAmount) }],
        });
      }
    }

    if (inc.type === "social_security") {
      if (inRange(inc.startYear, projection)) {
        out.push({
          id: `income:ss_begin:${subject}:${inc.id}`,
          year: inc.startYear,
          category: "income",
          subject,
          title: `${inc.name} begins`,
          supportingFigure: `${currency(inc.annualAmount)}/yr SS`,
          details: [{ label: "Annual", value: currency(inc.annualAmount) }],
        });
      }
    }
  }

  return out;
}
