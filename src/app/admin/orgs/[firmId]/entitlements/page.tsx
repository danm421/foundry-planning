import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { firms } from "@/db/schema";
import {
  CAPABILITY_KEYS,
  computeFirmEntitlements,
  getActiveOverrides,
} from "@/lib/ops/entitlements";
import { deriveUserEntitlements } from "@/lib/billing/entitlements";
import { getActiveUserOverridesForFirm } from "@/lib/entitlements/user-overrides";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import EntitlementsClient, { type EntitlementRow } from "./entitlements-client";
import MemberEntitlements, { type MemberEntitlementRow } from "./member-entitlements";

export const dynamic = "force-dynamic";

export default async function EntitlementsPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  const [firm] = await db.select().from(firms).where(eq(firms.firmId, firmId)).limit(1);
  if (!firm) notFound();

  const [effective, overrides, members, userOverrides] = await Promise.all([
    computeFirmEntitlements(firmId),
    getActiveOverrides(firmId),
    listFirmMembers(firmId),
    getActiveUserOverridesForFirm(firmId),
  ]);
  const overrideByKey = new Map(overrides.map((o) => [o.entitlement, o]));

  const known: EntitlementRow[] = CAPABILITY_KEYS.map((c) => {
    const ov = overrideByKey.get(c.key);
    return {
      key: c.key,
      label: c.label,
      description: c.description,
      enabled: effective.includes(c.key),
      overrideMode: ov?.mode ?? null,
      reason: ov?.reason ?? null,
      setBy: ov?.setBy ?? null,
      createdAt: ov?.createdAt ? ov.createdAt.toISOString() : null,
    };
  });

  const knownKeys = new Set(CAPABILITY_KEYS.map((c) => c.key));
  const extra: EntitlementRow[] = overrides
    .filter((o) => !knownKeys.has(o.entitlement))
    .map((o) => ({
      key: o.entitlement,
      label: o.entitlement,
      description: "(no registry entry — set via SQL or a future capability)",
      enabled: effective.includes(o.entitlement),
      overrideMode: o.mode,
      reason: o.reason,
      setBy: o.setBy,
      createdAt: o.createdAt.toISOString(),
    }));

  // Only capabilities flagged per-user get member controls — no dead UI for the
  // firm-only AI keys, and it matches the gate in `toggleUserEntitlementAction`.
  const perUserCaps = CAPABILITY_KEYS.filter((c) => c.perUser);
  const memberRows: MemberEntitlementRow[] = members.map((m) => {
    const theirs = userOverrides.get(m.userId) ?? [];
    const eff = deriveUserEntitlements({ firmEntitlements: effective, overrides: theirs });
    return {
      userId: m.userId,
      displayName: m.displayName,
      email: m.email,
      caps: perUserCaps.map((c) => {
        const ov = theirs.find((o) => o.entitlement === c.key) ?? null;
        return {
          key: c.key,
          label: c.label,
          enabled: eff.includes(c.key),
          overrideMode: ov?.mode ?? null,
          reason: ov?.reason ?? null,
          setBy: ov?.setBy ?? null,
          createdAt: ov?.createdAt ? ov.createdAt.toISOString() : null,
        };
      }),
    };
  });

  return (
    <div className="space-y-8">
      <EntitlementsClient firmId={firmId} rows={[...known, ...extra]} />
      <MemberEntitlements firmId={firmId} rows={memberRows} />
    </div>
  );
}
