import { clerkClient } from "@clerk/nextjs/server";
import { firmBookSiloEnabled, firmClaudeWritesEnabled } from "@/lib/firm-settings";
import FirmNameForm from "./firm-name-form";
import ComplianceExportPanel from "./compliance-export-panel";
import BookSiloToggle from "./book-silo-toggle";
import ClaudeWritesToggle from "./claude-writes-toggle";

interface Props {
  orgId: string;
  isFounder: boolean;
}

export async function FirmContent({ orgId, isFounder }: Props) {
  const cc = await clerkClient();
  const [org, bookSiloEnabled, claudeWritesEnabled] = await Promise.all([
    cc.organizations.getOrganization({ organizationId: orgId }),
    firmBookSiloEnabled(orgId),
    firmClaudeWritesEnabled(orgId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-medium text-ink">Firm</h1>
      <FirmNameForm initial={org.name} firmId={orgId} isFounder={isFounder} />
      <BookSiloToggle initial={bookSiloEnabled} />
      <ClaudeWritesToggle initial={claudeWritesEnabled} />
      <ComplianceExportPanel />
    </div>
  );
}
