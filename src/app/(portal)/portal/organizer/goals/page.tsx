import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import OrganizerGoalsScreen from "@/components/portal/organizer-goals-screen";

export default async function OrganizerGoalsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <OrganizerGoalsScreen clientId={clientId} />;
}
