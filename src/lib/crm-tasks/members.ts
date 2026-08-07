import "server-only";
import { cache } from "react";
import { clerkClient } from "@clerk/nextjs/server";

export type FirmMember = {
  userId: string;
  displayName: string;
  email: string | null;
  imageUrl: string | null;
  /** Friendly Clerk org role, e.g. "Admin" / "Member". DISPLAY ONLY. */
  role: string;
  /**
   * The raw Clerk org role key, e.g. "org:admin" / "org:advisor". Gate on THIS,
   * never on `role` — `role` is a lossy display transform (it strips the
   * "org:" prefix, title-cases, and collapses `basic_member` to "Member"), so
   * two distinct Clerk roles can render the same string.
   */
  roleKey: string;
};

/**
 * List Clerk organization members for the given firm.
 *
 * Wrapped in React `cache()` so multiple consumers within the same request
 * (e.g. task list + assignee picker) hit Clerk once.
 */
export const listFirmMembers = cache(async (firmId: string): Promise<FirmMember[]> => {
  const client = await clerkClient();
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: firmId,
    limit: 100,
  });
  return memberships.data.map((m) => {
    const u = m.publicUserData;
    const name =
      [u?.firstName, u?.lastName].filter(Boolean).join(" ") ||
      u?.identifier ||
      u?.userId ||
      "Unknown";
    // Clerk role keys look like "org:admin" / "basic_member"; render them friendly.
    const rawRole = m.role.replace(/^org:/, "");
    const role =
      rawRole === "basic_member"
        ? "Member"
        : rawRole.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Member";
    return {
      userId: u?.userId ?? m.id,
      displayName: name,
      email: u?.identifier ?? null,
      imageUrl: u?.imageUrl ?? null,
      role,
      roleKey: m.role,
    };
  });
});
