import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import Forbidden from "../forbidden";
import { getConnection } from "@/lib/orion/connections";
import { OrionConnectionCard } from "@/components/OrionConnectionCard";
import { OrionHouseholdLinkTable } from "@/components/OrionHouseholdLinkTable";

export default async function OrionIntegrationsPage(): Promise<ReactElement> {
  try {
    await requireOrgAdminOrOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden requiredRole="admin or owner" />;
    throw err;
  }

  const { orgId: firmId } = await auth();
  if (!firmId) return <Forbidden requiredRole="admin or owner" />;

  const conn = await getConnection(firmId);
  const connected = !!conn && conn.status !== "disconnected";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Orion</h1>
        <p className="text-sm text-ink-3">
          Sync accounts and holdings from your Orion households into Foundry.
        </p>
      </header>
      <OrionConnectionCard
        status={conn?.status ?? "disconnected"}
        lastSyncedAt={conn?.lastSyncedAt ? conn.lastSyncedAt.toISOString() : null}
        lastSyncError={conn?.lastSyncError ?? null}
      />
      {connected ? <OrionHouseholdLinkTable /> : null}
    </div>
  );
}
