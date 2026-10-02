import type { ClientData, LtcEvent } from "@/engine/types";
import {
  DEFAULT_CARE_INFLATION,
  DEFAULT_CARE_START_AGE,
  DEFAULT_CARE_YEARS,
  presetAnnualCost,
} from "./care-cost-presets";
import { ltcEventName } from "./ltc-event-name";

/** The event a fresh toggle creates: the client, a private nursing room. */
export function defaultLtcEvent(tree: ClientData): LtcEvent {
  const birthYear = parseInt(String(tree.client.dateOfBirth).slice(0, 4), 10);
  const ageAtStart = tree.planSettings.planStartYear - birthYear;
  const startAge = Number.isFinite(ageAtStart)
    ? Math.max(DEFAULT_CARE_START_AGE, ageAtStart)
    : DEFAULT_CARE_START_AGE;
  const base: Omit<LtcEvent, "name"> = {
    id: crypto.randomUUID(),
    people: [
      {
        person: "client",
        startAge,
        years: DEFAULT_CARE_YEARS,
        careSetting: "nursing_private",
        annualCost: presetAnnualCost("nursing_private")!,
        costInflation: DEFAULT_CARE_INFLATION,
      },
    ],
    livingExpenseCutPct: null,
    homeSale: null,
    includePolicies: true,
  };
  return { ...base, name: ltcEventName(base, tree.client) };
}
