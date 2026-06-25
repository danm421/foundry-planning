import { and, eq } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { intakeEmailSettings } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import EmailSettingsEditor from "@/components/intake/admin/email-settings-editor";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const { orgId: firmId, userId } = await requireOrgAndUser();
  const { sessionClaims } = await auth();
  const firmName = (sessionClaims as { org_name?: string } | null)?.org_name ?? "";
  const advisor = await currentUser();
  const advisorName =
    [advisor?.firstName, advisor?.lastName].filter(Boolean).join(" ") || "";
  const advisorEmail = advisor?.primaryEmailAddress?.emailAddress ?? "";

  const [row] = await db
    .select()
    .from(intakeEmailSettings)
    .where(and(eq(intakeEmailSettings.firmId, firmId), eq(intakeEmailSettings.userId, userId)));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Invitation email
        </h1>
        <p className="mt-1 text-[14px] text-ink-3">
          Customize how your data-collection invitation looks to clients. Changes apply to every form you send.
        </p>
      </div>
      <EmailSettingsEditor
        initial={{ fromName: row?.fromName ?? "", subject: row?.subject ?? "", introBody: row?.introBody ?? "" }}
        advisorName={advisorName}
        advisorEmail={advisorEmail}
        firmName={firmName}
      />
    </div>
  );
}
