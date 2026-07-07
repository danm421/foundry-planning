import Link from "next/link";
import { requireOrgId } from "@/lib/db-helpers";
import { listFormsForFirm } from "@/lib/intake/queries";
import Queue from "@/components/intake/admin/queue";
import SendProspectForm from "@/components/intake/admin/send-prospect-form";

export default async function DataCollectionPage() {
  const orgId = await requireOrgId();
  const forms = await listFormsForFirm(orgId);

  const groups = [
    { label: "Needs review", forms: forms.filter((f) => f.status === "submitted") },
    { label: "In flight", forms: forms.filter((f) => f.status === "draft") },
    {
      label: "History",
      forms: forms.filter((f) =>
        f.status === "applied" || f.status === "discarded" || f.status === "expired",
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Data Collection
        </h1>
        <p className="mt-1 text-[14px] text-ink-3">
          Review submitted intake forms and send new ones to prospects.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          <Link href="/data-collection/email-settings"
            className="text-[13px] font-medium text-accent hover:underline">
            Customize invitation email →
          </Link>
          <a
            href="/data-collection/preview"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-medium text-accent hover:underline">
            Preview form ↗
          </a>
        </div>
      </div>
      <div className="space-y-8">
        <Queue groups={groups} />
        <SendProspectForm />
      </div>
    </div>
  );
}
