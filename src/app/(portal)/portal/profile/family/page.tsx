import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import FamilySection from "@/components/portal/family-section";

export default async function FamilyPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <FamilySection clientId={clientId} />;
}
