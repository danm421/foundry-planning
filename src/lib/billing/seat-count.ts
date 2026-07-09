// Seat-count helpers shared by the Clerk membership webhook and the billing
// reconcile cron. Both need "how many seats should this firm be billed for",
// and both must read it the SAME way — the underbilling bug came from a
// hand-rolled read that diverged from the Clerk SDK's actual shape.

/** Minimal structural view of the Clerk client's paginated membership list. */
type MembershipLister = {
  organizations: {
    getOrganizationMembershipList: (params: {
      organizationId: string;
      limit?: number;
    }) => Promise<{ data: unknown[]; totalCount?: number }>;
  };
};

/**
 * Absolute org member count for seat billing.
 *
 * Reads the paginated response's `totalCount` — the API-reported total, which
 * the Clerk SDK exposes camelCase and reports independently of `limit`. We only
 * want the count, so `limit: 1` avoids deserializing a page of member objects.
 * Do NOT use `data.length`: it is capped by `limit`, so it would undercount
 * (the seat-underbilling defect). `data.length` is only a defensive fallback
 * for the (per the SDK contract, impossible) case where `totalCount` is absent.
 */
export async function getOrgMemberCount(
  cc: MembershipLister,
  firmId: string,
): Promise<number> {
  const members = await cc.organizations.getOrganizationMembershipList({
    organizationId: firmId,
    limit: 1,
  });
  return members.totalCount ?? members.data.length;
}

/** Stripe seat quantity for a member count — never bills fewer than 1 seat. */
export function expectedSeatQuantity(memberCount: number): number {
  return Math.max(1, memberCount);
}
