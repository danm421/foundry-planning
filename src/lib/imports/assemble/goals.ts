import type { AssembleGoals } from "./types";
import { blank } from "./field";

/** All-empty goals, for an import assembled before this feature existed. */
export function emptyGoals(): AssembleGoals {
  return { education: [], homePurchases: [], riskTolerance: blank<string>() };
}
