import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import RecurringsSection from "@/components/portal/recurrings-section";

export default async function RecurringsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <RecurringsSection clientId={clientId} />;
}
