import { clerkClient } from "@clerk/nextjs/server";

export type OrgInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type OrgInvitationRow = {
  id: string;
  email: string;
  /** Clerk's display name for the role, e.g. "Admin" / "Member". */
  role: string;
  status: OrgInvitationStatus;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms, null when the invitation never expires. */
  expiresAt: number | null;
};

/** The shape we consume off Clerk's `OrganizationInvitation` — all we need to render a row. */
type InvitationInput = {
  id: string;
  emailAddress: string;
  role: string;
  roleName?: string;
  status?: string;
  createdAt: number;
  expiresAt?: number | null;
};

const STATUSES: OrgInvitationStatus[] = ["pending", "accepted", "revoked", "expired"];

/**
 * Pure mapper: Clerk invitations → ops table rows, newest first.
 *
 * Clerk reports a lapsed invitation as `pending` until something touches it, so
 * a pending row past its `expiresAt` is re-labelled `expired` — otherwise ops
 * reads a dead invite as one the recipient could still accept.
 */
export function buildInvitationRows(
  invitations: InvitationInput[],
  now: number,
): OrgInvitationRow[] {
  return invitations
    .map((inv) => {
      const raw = (inv.status ?? "pending") as OrgInvitationStatus;
      const expiresAt = inv.expiresAt ?? null;
      const lapsed = raw === "pending" && expiresAt !== null && expiresAt < now;
      return {
        id: inv.id,
        email: inv.emailAddress,
        role: inv.roleName || inv.role.replace(/^org:/, "").replace(/_/g, " ") || "Member",
        status: lapsed ? ("expired" as const) : raw,
        createdAt: inv.createdAt,
        expiresAt,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Every invitation ever sent from the org, across all statuses. Clerk's default
 * filter is pending-only, so the statuses are requested explicitly.
 */
export async function listOrgInvitations(firmId: string): Promise<OrgInvitationRow[]> {
  const client = await clerkClient();
  const res = await client.organizations.getOrganizationInvitationList({
    organizationId: firmId,
    status: STATUSES,
    limit: 100,
  });
  return buildInvitationRows(res.data, Date.now());
}
