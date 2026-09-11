import "server-only";
import type { BindingRef } from "@/lib/portal/bindings";
import { resolveHouseholdNames, UNNAMED_HOUSEHOLD } from "@/lib/portal/household-names";
import { resolvePortalFirmNames, UNNAMED_FIRM } from "@/lib/portal/firm-names";

/** One entry in the portal's household picker. `label` is already resolved and
 *  already fallen back — the client component renders it verbatim. */
export interface PortalHouseholdOption {
  clientId: string;
  label: string;
}

/** What separates the two halves of an option. A middle dot, matching the
 *  Connected-firms card on the sibling Settings screen. */
const LABEL_SEPARATOR = " · ";

/**
 * The households this login may switch between, labelled for a picker.
 *
 * **Every option reads `<household> · <firm>`, unconditionally.** A person held
 * by two firms has TWO `clients` rows for the SAME real family, and both
 * commonly derive the SAME household name — so a picker labelled by household
 * name alone shows two identical options to exactly the client this control
 * exists for. Naming the firm is also the honest description of what the switch
 * does: it changes whose view of you you are looking at, not which family.
 *
 * Returns `[]` below two households, and does NOT pay for the two name lookups
 * in that case. Twenty-nine of thirty real households hold one binding, this
 * runs on every portal page render, and there is nothing to choose between when
 * there is one of something.
 *
 * `bindings` must already be scoped to the authenticated user — this function
 * labels what it is handed and authorizes nothing. `getPortalBindings` returns
 * ACTIVE rows only, so a revoked binding can never reach the picker.
 */
export async function loadPortalHouseholdOptions(
  bindings: readonly BindingRef[],
): Promise<PortalHouseholdOption[]> {
  if (bindings.length < 2) return [];

  // Two independent lookups; neither feeds the other.
  const [householdNames, firmNames] = await Promise.all([
    resolveHouseholdNames(bindings.map((b) => b.clientId)),
    resolvePortalFirmNames(bindings.map((b) => b.firmId)),
  ]);

  return bindings.map((b) => ({
    clientId: b.clientId,
    label:
      (householdNames.get(b.clientId) ?? UNNAMED_HOUSEHOLD) +
      LABEL_SEPARATOR +
      (firmNames.get(b.firmId) ?? UNNAMED_FIRM),
  }));
}
