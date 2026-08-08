import type { Signal, SignalInput } from "./types";

export const NO_CONTACT_DAYS = 90;
/** Plan years ahead within which a life event is worth raising now. */
export const LIFE_EVENT_HORIZON_YEARS = 3;

const daysBetween = (a: Date, b: Date): number =>
  Math.floor((a.getTime() - b.getTime()) / 86_400_000);

export function relationshipSignals(input: SignalInput): Signal[] {
  const { relationship: r, now, clientId } = input;
  const out: Signal[] = [];

  if (r.overdueTaskCount > 0) {
    const plural = r.overdueTaskCount === 1 ? "" : "s";
    out.push({
      id: "relationship.overdue_tasks",
      domain: "relationship",
      severity: "watch",
      title: `${r.overdueTaskCount} overdue task${plural}`,
      detail: `${r.overdueTaskCount} task${plural} on this household ${r.overdueTaskCount === 1 ? "is" : "are"} past its due date.`,
      numbers: { overdueTaskCount: r.overdueTaskCount },
      href: `/crm/households/${clientId}`,
      estimatedImpact: null,
    });
  }

  // Never contacted and stale contact are different calls to action.
  if (!r.lastContactAt) {
    out.push({
      id: "relationship.never_contacted",
      domain: "relationship",
      severity: "info",
      title: "No contact has ever been logged",
      detail: "This household has no logged calls, meetings, or notes yet.",
      numbers: {},
      href: `/crm/households/${clientId}`,
      estimatedImpact: null,
    });
  } else if (daysBetween(now, r.lastContactAt) > NO_CONTACT_DAYS) {
    const days = daysBetween(now, r.lastContactAt);
    out.push({
      id: "relationship.stale_contact",
      domain: "relationship",
      severity: "watch",
      title: `No contact in ${days} days`,
      detail: `The last logged contact was ${days} days ago, past the ${NO_CONTACT_DAYS}-day mark.`,
      numbers: { days },
      href: `/crm/households/${clientId}`,
      estimatedImpact: null,
    });
  }

  if (r.portalInvitedAt && !r.portalFirstLoginAt) {
    out.push({
      id: "relationship.portal_never_used",
      domain: "relationship",
      severity: "info",
      title: "Client portal invitation never used",
      detail: "The household was invited to the portal but has never signed in.",
      numbers: {},
      href: `/crm/households/${clientId}`,
      estimatedImpact: null,
    });
  }

  // Measured against planStartYear, NOT the calendar — see the test.
  const upcoming = r.lifeEvents
    .filter((e) => e.year >= r.planStartYear && e.year - r.planStartYear <= LIFE_EVENT_HORIZON_YEARS)
    .sort((a, b) => a.year - b.year);
  if (upcoming.length > 0) {
    out.push({
      id: "relationship.upcoming_life_event",
      domain: "relationship",
      severity: "info",
      title: "Life events coming up in the plan",
      detail: upcoming.map((e) => `${e.label} in ${e.year}`).join("; ") + ".",
      numbers: { count: upcoming.length, nextYear: upcoming[0].year },
      href: `/clients/${clientId}/overview`,
      estimatedImpact: null,
    });
  }

  return out;
}
