import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import { loadOrSeedPortalIntakeForm } from "@/lib/intake/load-or-seed";
import { resolveIntakeBranding } from "@/lib/branding/branding";
import { PortalIntakeClient } from "./intake-client";

export default async function PortalIntakePage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();

  // Resolve firmId for the seed (same pattern as resolveAuth() in the route)
  const [clientRow] = await db
    .select({ firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  const firmId = clientRow?.firmId;
  if (!firmId) redirect("/portal/profile");

  const result = await loadOrSeedPortalIntakeForm(clientId, firmId);
  if (!result) redirect("/portal/profile");

  const branding = await resolveIntakeBranding(firmId);

  return (
    <PortalIntakeClient
      initialPayload={result.payload}
      initialStatus={result.status}
      recipientName={result.recipientName}
      branding={branding}
    />
  );
}
