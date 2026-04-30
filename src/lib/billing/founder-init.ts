import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

export type FounderInitOptions = {
  firmId: string;
  displayName: string;
  ownerUserId: string;
  entitlements: string[];
};

export type FounderState = {
  current: {
    orgName: string;
    publicMetadata: Record<string, unknown>;
    ownerRole: string | null;
    firmsRowExists: boolean;
  };
  target: {
    orgName: string;
    publicMetadata: { is_founder: true; subscription_status: "founder"; entitlements: string[] };
    ownerRole: "org:owner";
    firmsRowExists: true;
  };
  drift: string[];
};

const TARGET_ROLE = "org:owner";
const FOUNDER_STATUS = "founder";

/**
 * Read the current Clerk org + firms row state and compare to the desired
 * founder configuration. Returns a drift list — empty when fully applied.
 *
 * Pure-ish: makes Clerk + DB reads only. No writes.
 */
export async function getFounderState(opts: FounderInitOptions): Promise<FounderState> {
  const { firmId, displayName, ownerUserId, entitlements } = opts;
  const cc = await clerkClient();

  const org = await cc.organizations.getOrganization({ organizationId: firmId });
  const memberships = await cc.organizations.getOrganizationMembershipList({
    organizationId: firmId,
    limit: 100,
  });
  const ownerMembership = memberships.data.find(
    (m) => m.publicUserData?.userId === ownerUserId,
  );
  const firmsRow = await db.select().from(firms).where(eq(firms.firmId, firmId));

  const currentMeta = (org.publicMetadata ?? {}) as Record<string, unknown>;
  const currentEntitlements = Array.isArray(currentMeta.entitlements)
    ? (currentMeta.entitlements as unknown[]).map(String)
    : [];

  const drift: string[] = [];
  if (org.name !== displayName) drift.push("name");
  if (currentMeta.is_founder !== true) drift.push("metadata.is_founder");
  if (currentMeta.subscription_status !== FOUNDER_STATUS)
    drift.push("metadata.subscription_status");
  if (
    currentEntitlements.length !== entitlements.length ||
    !entitlements.every((e) => currentEntitlements.includes(e))
  ) {
    drift.push("metadata.entitlements");
  }
  if (!ownerMembership) drift.push("membership.missing");
  else if (ownerMembership.role !== TARGET_ROLE) drift.push("membership.role");
  if (firmsRow.length === 0) drift.push("firms.row");

  return {
    current: {
      orgName: org.name,
      publicMetadata: currentMeta,
      ownerRole: ownerMembership?.role ?? null,
      firmsRowExists: firmsRow.length > 0,
    },
    target: {
      orgName: displayName,
      publicMetadata: {
        is_founder: true,
        subscription_status: FOUNDER_STATUS,
        entitlements,
      },
      ownerRole: TARGET_ROLE,
      firmsRowExists: true,
    },
    drift,
  };
}

/**
 * Bring the org and firms row into the founder configuration. Idempotent —
 * only writes the fields listed in `state.drift`. No-op when drift is empty.
 *
 * Throws if the named ownerUserId is not a member of the org (operator
 * mistake — fail loudly, don't auto-invite).
 */
export async function applyFounderState(opts: FounderInitOptions): Promise<void> {
  const { firmId, displayName, ownerUserId, entitlements } = opts;
  const cc = await clerkClient();
  const state = await getFounderState(opts);

  if (state.drift.includes("membership.missing")) {
    throw new Error(
      `User ${ownerUserId} is not a member of org ${firmId} — cannot promote to ${TARGET_ROLE}`,
    );
  }

  if (state.drift.length === 0) {
    // Fully applied — no audit row, no writes.
    return;
  }

  if (state.drift.includes("name")) {
    // Clerk SDK signature: updateOrganization(organizationId, params).
    await cc.organizations.updateOrganization(firmId, { name: displayName });
  }

  const metadataDrifted =
    state.drift.includes("metadata.is_founder") ||
    state.drift.includes("metadata.subscription_status") ||
    state.drift.includes("metadata.entitlements");
  if (metadataDrifted) {
    // Clerk SDK signature: updateOrganizationMetadata(organizationId, params).
    await cc.organizations.updateOrganizationMetadata(firmId, {
      publicMetadata: {
        ...state.current.publicMetadata,
        is_founder: true,
        subscription_status: FOUNDER_STATUS,
        entitlements,
      },
    });
  }

  if (state.drift.includes("membership.role")) {
    await cc.organizations.updateOrganizationMembership({
      organizationId: firmId,
      userId: ownerUserId,
      role: TARGET_ROLE,
    });
  }

  if (state.drift.includes("firms.row")) {
    await db.insert(firms).values({
      firmId,
      displayName,
      isFounder: true,
    });
  }

  await recordAudit({
    action: "firm.founder_initialized",
    resourceType: "firm",
    resourceId: firmId,
    firmId,
    actorId: "system:founder-init",
    metadata: { drift: state.drift, ownerUserId, entitlements },
  });
}
