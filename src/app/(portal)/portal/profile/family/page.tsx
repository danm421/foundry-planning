import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, familyMembers } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import ProfileFamilyList from "@/components/portal/profile-family-list";

export default async function FamilyPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();

  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  const rows = await db
    .select({
      id: familyMembers.id,
      firstName: familyMembers.firstName,
      lastName: familyMembers.lastName,
      relationship: familyMembers.relationship,
      dateOfBirth: familyMembers.dateOfBirth,
    })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, clientId));

  return (
    <div className="p-5 max-w-2xl">
      <ProfileFamilyList rows={rows} editEnabled={client.portalEditEnabled} />
    </div>
  );
}
