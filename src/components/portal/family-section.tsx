import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, familyMembers } from "@/db/schema";
import ProfileFamilyList from "@/components/portal/profile-family-list";

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

  const editEnabled = client?.portalEditEnabled ?? false;

  return (
    <div className="max-w-2xl p-5">
      <ProfileFamilyList rows={rows} editEnabled={editEnabled} />
    </div>
  );
}
