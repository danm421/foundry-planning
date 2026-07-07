import { clerkClient } from "@clerk/nextjs/server";
import FirmNameForm from "./firm-name-form";
import ComplianceExportPanel from "./compliance-export-panel";

interface Props {
  orgId: string;
  isFounder: boolean;
}

export async function FirmContent({ orgId, isFounder }: Props) {
  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: orgId });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-medium text-ink">Firm</h1>
      <FirmNameForm initial={org.name} firmId={orgId} isFounder={isFounder} />
      <ComplianceExportPanel />
    </div>
  );
}
