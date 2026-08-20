import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import FamilyMemberCards from "@/components/portal/family-member-cards";
import { loadPortalFamily } from "@/lib/portal/load-profile-data";

interface Props {
  clientId: string;
}

export default async function FamilySection({
  clientId,
}: Props): Promise<ReactElement> {
  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  // Same loader the GET route (and so the phone app) uses, rather than a second
  // copy of the query — it owns the rule that the household's own client and
  // spouse rows don't belong in Family.
  const rows = await loadPortalFamily(clientId);

  const editEnabled = client?.portalEditEnabled ?? false;

  return (
    <div className="max-w-4xl p-5 sm:p-6">
      <FamilyMemberCards rows={rows} editEnabled={editEnabled} />
    </div>
  );
}
