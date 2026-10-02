import type { ClientData, LtcEvent } from "@/engine/types";
import { birthYearFromDob } from "@/lib/age-year";
import { DEFAULT_CARE_START_AGE, defaultCarePerson } from "./care-cost-presets";
import { ltcEventName } from "./ltc-event-name";

/** The event a fresh toggle creates: the client, a private nursing room. */
export function defaultLtcEvent(tree: ClientData): LtcEvent {
  const birthYear = birthYearFromDob(tree.client.dateOfBirth);
  const startAge =
    birthYear == null
      ? DEFAULT_CARE_START_AGE
      : Math.max(DEFAULT_CARE_START_AGE, tree.planSettings.planStartYear - birthYear);
  const base: Omit<LtcEvent, "name"> = {
    id: crypto.randomUUID(),
    people: [defaultCarePerson("client", startAge)],
    livingExpenseCutPct: null,
    homeSale: null,
    includePolicies: true,
  };
  return { ...base, name: ltcEventName(base, tree.client) };
}
