import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { loadFormForFirm } from "@/lib/intake/queries";
import { intakeSubmitSchema } from "@/lib/intake/schema";
import { snapshotClientToPayload } from "@/lib/intake/snapshot";
import { buildIntakeDiff } from "@/components/intake/admin/diff-utils";
import ReviewDetail from "@/components/intake/admin/review-detail";
import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DataCollectionReviewPage({ params }: Props) {
  const { id } = await params;
  const orgId = await requireOrgId();

  const form = await loadFormForFirm(id, orgId);
  if (!form) notFound();

  const parseResult = intakeSubmitSchema.safeParse(form.payload);
  if (!parseResult.success) notFound();
  const submitted = parseResult.data;

  let baseline = null;
  if (form.clientId) {
    try {
      baseline = await snapshotClientToPayload(form.clientId, orgId);
    } catch {
      // client not found or no scenario — treat as no baseline
      baseline = null;
    }
  }

  const diff = buildIntakeDiff(baseline, submitted);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/data-collection"
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeftIcon width={14} height={14} />
          Data Collection
        </Link>
        <h1 className="mt-3 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {form.recipientName ?? form.recipientEmail}
        </h1>
      </div>
      <ReviewDetail form={form} diff={diff} />
    </div>
  );
}
