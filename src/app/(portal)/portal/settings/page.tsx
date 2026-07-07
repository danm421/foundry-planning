import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { loadPortalPrivacy } from "@/lib/portal/privacy";
import { PortalSettingsView } from "@/components/portal/portal-settings-view";

export default async function PortalSettingsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  const privacy = await loadPortalPrivacy(clientId);
  return <PortalSettingsView privacy={privacy} />;
}
