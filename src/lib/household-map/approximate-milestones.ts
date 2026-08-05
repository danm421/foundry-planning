// Rough `ClientMilestones` built from what a board already has — no new fetch.
// Seeds the Start/End milestone-anchor pickers on both surfaces: the advisor
// quick-edit drawer and the portal Organizer's flow panel.
//
// `planStart` is an estimate; the exact value lives server-side. That is safe
// because a picked ref is stored ALONGSIDE the resolved year and the engine
// re-resolves the effective year from the ref, not the stored year, on every
// load (`resolvedStart`/`resolvedEnd` in `lib/projection/load-client-data.ts`).
// An approximate resolution here is cosmetic and self-corrects on the next
// refresh.
//
// `currentYear` is a parameter rather than a `new Date()` call so the function
// is pure — the same rule the boards follow, and what lets it be tested without
// freezing the clock.
import type { ClientMilestones } from "@/lib/milestones";
import type { MapGoal } from "@/lib/household-map/goals";
import type { MapPeople } from "@/lib/household-map/types";

export function approximateMilestones(
  people: MapPeople,
  goals: MapGoal[],
  currentYear: number,
): ClientMilestones {
  const clientRetirement = people.client.retirementYear ?? currentYear + 10;
  // Each person's OWN death year, off their own life-expectancy card. A single
  // shared "plan end" here would offer "Spouse End of Plan" and "Client End of
  // Plan" as the same year for every household, and be wrong for one of them.
  const clientEnd =
    goals.find((g) => g.lifeExpectancy?.owner === "client")?.year ?? currentYear + 30;
  const spouseEnd = goals.find((g) => g.lifeExpectancy?.owner === "spouse")?.year;
  return {
    planStart: currentYear,
    // The plan runs to the LAST death — the whole reason both cards exist.
    planEnd: Math.max(clientEnd, spouseEnd ?? clientEnd),
    clientRetirement,
    clientEnd,
    spouseRetirement: people.spouse?.retirementYear ?? undefined,
    spouseEnd,
  };
}
