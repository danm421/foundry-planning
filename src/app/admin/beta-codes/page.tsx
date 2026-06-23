import { desc } from "drizzle-orm";
import { db } from "@/db";
import { betaCodes } from "@/db/schema";
import { CAPABILITY_KEYS } from "@/lib/ops/entitlements";
import BetaCodesClient, { type CodeRow } from "./beta-codes-client";

export const dynamic = "force-dynamic";

function deriveStatus(r: typeof betaCodes.$inferSelect): CodeRow["status"] {
  if (r.revokedAt) return "revoked";
  if (r.redeemedAt) return "redeemed";
  if (r.expiresAt && r.expiresAt.getTime() <= Date.now()) return "expired";
  return "unused";
}

export default async function BetaCodesPage() {
  const rows = await db.select().from(betaCodes).orderBy(desc(betaCodes.createdAt));
  const codes: CodeRow[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    entitlements: r.entitlements,
    status: deriveStatus(r),
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    redeemedByUserId: r.redeemedByUserId,
    redeemedOrgId: r.redeemedOrgId,
  }));
  // CAPABILITY_KEYS lives in a server module (imports db/clerk); the server page
  // reads it and hands the client this plain serializable list, so the "use
  // client" file never pulls server code into the bundle. Forge (ai_forge) is an
  // option automatically — add a key there and it shows up here.
  return <BetaCodesClient initialCodes={codes} capabilities={CAPABILITY_KEYS} />;
}
