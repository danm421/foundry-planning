import type { AssemblePlanBasics } from "./types";
import { blank } from "./field";

/**
 * All-blank plan basics for an import assembled before this feature
 * existed, or one where an earlier plan build's derivation had too little
 * evidence to run at all (the assemble step required both `retirementAge`
 * and `lifeExpectancy` to be known). Every field is blank and unflagged — no
 * `reason`, so no chip — so the wizard's Plan basics step renders empty
 * inputs instead of crashing on a missing `planBasics` block.
 */
export function emptyPlanBasics(): AssemblePlanBasics {
  return {
    retirementAge: blank<number>(),
    lifeExpectancy: blank<number>(),
    currentLivingSpending: blank<number>(),
    retirementLivingSpending: blank<number>(),
    socialSecurity: [],
  };
}
