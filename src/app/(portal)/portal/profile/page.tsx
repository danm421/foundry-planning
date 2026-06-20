import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import HouseholdSection from "@/components/portal/household-section";

export default async function HouseholdPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <HouseholdSection clientId={clientId} />;
}
