import type { ClientData, ProjectionYear, Income } from "@foundry/engine";
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

function ageAtYear(dob: string | undefined, year: number): number | undefined {
  if (!dob) return undefined;
  const birthYear = new Date(dob).getUTCFullYear();
  return year - birthYear;
}

export function detectIncomeEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  for (const inc of data.incomes) {
    const subject = subjectFor(inc.owner);
    const dob = subject === "primary" ? data.client.dateOfBirth : subject === "spouse" ? data.client.spouseDob : undefined;

    if (inc.type === "salary") {
      if (inRange(inc.startYear, projection)) {
        out.push({
          id: `income:salary_start:${subject}:${inc.id}`,
          year: inc.startYear,
          age: ageAtYear(dob, inc.startYear),
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
          age: ageAtYear(dob, inc.endYear),
          category: "income",
          subject,
          title: `${inc.name} ends`,
          supportingFigure: `${currency(inc.annualAmount)}/yr ends`,
          details: [{ label: "Final annual", value: currency(inc.annualAmount) }],
        });
      }
    }

    if (inc.type === "social_security") {
      // Note: when the Life detector fires `life:ss_claim:<subject>` for the same
      // year+subject, the orchestrator (build-timeline.ts) drops this event in
      // favor of the Life one. Keep emission here unconditional so the income
      // detector remains independent of ordering.
      if (inRange(inc.startYear, projection)) {
        out.push({
          id: `income:ss_begin:${subject}:${inc.id}`,
          year: inc.startYear,
          age: ageAtYear(dob, inc.startYear),
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
