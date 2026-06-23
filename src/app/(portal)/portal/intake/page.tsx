import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import { loadOrSeedPortalIntakeForm } from "@/lib/intake/load-or-seed";
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

  return (
    <PortalIntakeClient
      initialPayload={result.payload}
      initialStatus={result.status}
      recipientName={result.recipientName}
    />
  );
}
