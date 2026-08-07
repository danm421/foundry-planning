import { and, eq } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { intakeEmailSettings } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { resolveFirmName } from "@/lib/activity/resolve-firm-names";
import EmailSettingsEditor from "@/components/intake/admin/email-settings-editor";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const { orgId: firmId, userId } = await requireOrgAndUser();
  const firmName = (await resolveFirmName(firmId)) ?? "";
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
          Data collection settings
        </h1>
        <p className="mt-1 text-[14px] text-ink-3">
          Customize the invitation email and which steps your forms collect. Changes apply to every form you send from here on.
        </p>
      </div>

      {/* Two independent sections, each savable on its own. The editor below
          renders its own cards, so this is a section heading rather than a
          third card wrapping two. */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Invitation email</h2>
        <EmailSettingsEditor
          initial={{ fromName: row?.fromName ?? "", subject: row?.subject ?? "", introBody: row?.introBody ?? "" }}
          advisorName={advisorName}
          advisorEmail={advisorEmail}
          firmName={firmName}
        />
      </section>
    </div>
  );
}
