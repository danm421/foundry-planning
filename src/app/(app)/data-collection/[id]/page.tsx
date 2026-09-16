import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { loadFormForFirm } from "@/lib/intake/queries";
import { findIntakeHousehold, listIntakeDocuments } from "@/lib/intake/documents";
import { intakeSubmitSchemaFor } from "@/lib/intake/schema";
import { sectionsForForm } from "@/lib/intake/sections";
import { snapshotClientToPayload } from "@/lib/intake/snapshot";
import { buildIntakeDiff } from "@/components/intake/admin/diff-utils";
import ReviewDetail from "@/components/intake/admin/review-detail";
import PendingDetail from "@/components/intake/admin/pending-detail";
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

  const sections = sectionsForForm(form.sections);
  const title = form.recipientName ?? form.recipientEmail;

  // Both of these are non-minting: a prospect who never uploaded has no
  // household, and merely opening this page must not create one. `findIntake-
  // Household` is called alongside the list because the vault download link
  // needs the id, and the client-facing document view deliberately omits it.
  const attachments = () =>
    Promise.all([listIntakeDocuments(form.id), findIntakeHousehold(form.id)]);

  // No submission means nothing to review — and a payload the client is
  // halfway through typing cannot satisfy the submit schema, so the parse
  // below would fail and 404 the row the advisor just clicked. Its own view
  // instead: who it went to, whether they opened it, how far they got.
  //
  // `submittedAt`, not a list of statuses: it is written at the two submit
  // sites and nowhere else, so it covers a draft, a revoked form AND a draft
  // the advisor discarded before it came back — that last one is why the
  // status list was wrong. A sixth status needs no change here.
  if (form.submittedAt === null) {
    const [documents, householdId] = await attachments();
    return (
      <Shell title={title}>
        <PendingDetail
          form={form}
          sections={sections}
          documents={documents}
          householdId={householdId}
        />
      </Shell>
    );
  }

  const parseResult = intakeSubmitSchemaFor(sections).safeParse(form.payload);
  if (!parseResult.success) notFound();
  const submitted = parseResult.data;

  // Three independent reads — the baseline does not depend on the uploads, and
  // awaiting it separately spent a whole round trip of latency on every review.
  const [[documents, householdId], baseline] = await Promise.all([
    attachments(),
    // Same section set the submission was parsed against. An un-sectioned
    // baseline would carry live accounts/income the form never asked for, and
    // the list diffs would render "3 → 0" — a deletion, on the very screen
    // where the advisor decides whether to write this to the plan.
    //
    // A missing client or scenario is "no baseline", not a broken page.
    form.clientId
      ? snapshotClientToPayload(form.clientId, orgId, sections).catch(() => null)
      : null,
  ]);

  const diff = buildIntakeDiff(baseline, submitted);

  return (
    <Shell title={title}>
      <ReviewDetail
        form={form}
        diff={diff}
        documents={documents}
        householdId={householdId}
      />
    </Shell>
  );
}

/** Page frame — shared so the two views can't drift apart. */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
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
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}
