import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { firms } from "@/db/schema";
import {
  CAPABILITY_KEYS,
  computeFirmEntitlements,
  getActiveOverrides,
} from "@/lib/ops/entitlements";
import EntitlementsClient, { type EntitlementRow } from "./entitlements-client";

export const dynamic = "force-dynamic";

export default async function EntitlementsPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  const [firm] = await db.select().from(firms).where(eq(firms.firmId, firmId)).limit(1);
  if (!firm) notFound();

  const [effective, overrides] = await Promise.all([
    computeFirmEntitlements(firmId),
    getActiveOverrides(firmId),
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

  return <EntitlementsClient firmId={firmId} rows={[...known, ...extra]} />;
}
