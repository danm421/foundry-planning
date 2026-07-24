import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import { loadOrSeedPortalIntakeForm } from "@/lib/intake/load-or-seed";
import { resolveIntakeBrandingForClient } from "@/lib/branding/resolve-for-client";
import { PortalIntakeClient } from "./intake-client";

export default async function PortalIntakePage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();

  // Resolve firmId/advisorId for the seed + branding (same pattern as
  // resolveAuth() in the route)
  const [clientRow] = await db
    .select({ firmId: clients.firmId, advisorId: clients.advisorId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!clientRow) redirect("/portal/profile");
  const { firmId, advisorId } = clientRow;

  // Independent reads — the seed (snapshot + possible insert) and the branding
  // lookup (DB read + Clerk name for branded firms) overlap instead of stacking.
  const [result, branding] = await Promise.all([
    loadOrSeedPortalIntakeForm(clientId, firmId),
    resolveIntakeBrandingForClient(firmId, advisorId),
  ]);
  if (!result) redirect("/portal/profile");

  return (
    <PortalIntakeClient
      initialPayload={result.payload}
      initialStatus={result.status}
      recipientName={result.recipientName}
      branding={branding}
    />
  );
}
