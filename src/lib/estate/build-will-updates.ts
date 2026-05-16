import type { Account, Will, WillBequest, WillBequestRecipient } from "@/engine/types";

export interface BuildWillUpdatesInput {
  account: Pick<Account, "id" | "name">;
  /** The will that receives the client's asset bequest (existing or owner default). */
  clientWill: Will;
  clientRecipients: WillBequestRecipient[];
  clientCondition: WillBequest["condition"];
  /** True when the client's bequest names the spouse as a recipient. */
  hasSpouseRecipient: boolean;
  /** Recipients of the spouse's second-death bequest. Empty = no cascade. */
  spouseCascadeRecipients: WillBequestRecipient[];
  /** The spouse's existing will, if they have one. */
  spouseWill: Will | null;
  /** Id generator — injected so callers (and tests) control id allocation. */
  newId: () => string;
}

/**
 * Apply the specific-asset bequest for `account` to `will`: update the
 * existing bequest for that account in place, or append a new one. Pure.
 */
function withAssetBequest(
  will: Will,
  account: Pick<Account, "id" | "name">,
  recipients: WillBequestRecipient[],
  condition: WillBequest["condition"],
  newId: () => string,
): Will {
  const existing = will.bequests.find(
    (b) => b.kind === "asset" && b.assetMode === "specific" && b.accountId === account.id,
  );
  // No recipients means "remove the bequest": drop the existing clause rather
  // than persisting a zero-recipient bequest (which the engine cannot split),
  // and never mint a new empty one.
  if (recipients.length === 0) {
    return existing
      ? { ...will, bequests: will.bequests.filter((b) => b.id !== existing.id) }
      : will;
  }
  if (existing) {
    return {
      ...will,
      bequests: will.bequests.map((b) =>
        b.id === existing.id ? { ...b, recipients, condition } : b,
      ),
    };
  }
  const bequest: WillBequest = {
    id: newId(),
    name: account.name,
    kind: "asset",
    assetMode: "specific",
    accountId: account.id,
    liabilityId: null,
    percentage: 100,
    condition,
    sortOrder: will.bequests.length,
    recipients,
  };
  return { ...will, bequests: [...will.bequests, bequest] };
}

/**
 * Compute the will(s) to persist from the distribution dialog's will tab.
 *
 * Always returns the client's will with the asset bequest applied. When the
 * bequest names the spouse and a cascade is set, also returns the spouse's
 * will — created if they have none — carrying the second-death bequest for
 * the same asset. Pure: no input is mutated.
 */
export function buildWillUpdates(input: BuildWillUpdatesInput): Will[] {
  const { account, clientWill, clientRecipients, clientCondition, newId } = input;

  const updates = new Map<string, Will>();
  updates.set(
    clientWill.id,
    withAssetBequest(clientWill, account, clientRecipients, clientCondition, newId),
  );

  if (input.hasSpouseRecipient && input.spouseCascadeRecipients.length > 0) {
    // Start from the spouse's existing will (or its already-updated copy if it
    // is the same will), else mint a fresh spouse will.
    const base =
      (input.spouseWill && updates.get(input.spouseWill.id)) ??
      input.spouseWill ??
      ({ id: newId(), grantor: "spouse", bequests: [], residuaryRecipients: [] } satisfies Will);
    // "always": the spouse's will governs the asset whenever the spouse dies
    // owning it — which is exactly the post-cascade second-death case.
    updates.set(
      base.id,
      withAssetBequest(base, account, input.spouseCascadeRecipients, "always", newId),
    );
  }

  return [...updates.values()];
}
