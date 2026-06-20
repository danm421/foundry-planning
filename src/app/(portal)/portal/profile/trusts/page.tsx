import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import TrustsSection from "@/components/portal/trusts-section";

export default async function TrustsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <TrustsSection clientId={clientId} />;
}
