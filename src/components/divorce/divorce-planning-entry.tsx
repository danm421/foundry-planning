// Entry point for the divorce workbench, mounted on the client's Family
// details page. Self-contained server component: it resolves its own firm
// scope and renders nothing unless the client files as married AND the
// household has a spouse contact — the two preconditions the draft service
// (getOrCreateDraft) enforces. A cheap live-draft probe flips the CTA copy
// between "Start" and "Resume" so an advisor mid-plan lands back where they
// left off.
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { divorcePlans } from "@/db/schema";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkDivorceEligibility } from "@/lib/divorce/divorce-plans";

export default async function DivorcePlanningEntry({
  clientId,
}: {
  clientId: string;
}) {
  const access = await verifyClientAccess(clientId);
  // Starting a plan is a write; hide the CTA from view-only (shared) users —
  // the /divorce route would only bounce them back to the overview.
  if (!access.ok || access.permission !== "edit") return null;

  // Eligibility (married filing + a spouse contact) gates whether the card
  // shows at all; the live-draft probe only flips its CTA copy. The two reads
  // are independent, so run them together.
  const [eligibility, draftRows] = await Promise.all([
    checkDivorceEligibility({ clientId, firmId: access.firmId }),
    db
      .select({ id: divorcePlans.id })
      .from(divorcePlans)
      .where(
        and(
          eq(divorcePlans.clientId, clientId),
          eq(divorcePlans.firmId, access.firmId),
          eq(divorcePlans.status, "draft"),
        ),
      ),
  ]);
  if (!eligibility.eligible) return null;
  const hasDraft = draftRows.length > 0;

  return (
    <section className="card mt-6 p-[var(--pad-card)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="chip">Household</span>
          <h3 className="mt-2.5 text-[16px] font-semibold text-ink">
            Divorce planning
          </h3>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-3">
            Model splitting this household into two independent households.
          </p>
        </div>
        <Link
          href={`/clients/${clientId}/divorce`}
          prefetch={false}
          className="btn-primary shrink-0 text-[13px]"
        >
          {hasDraft ? "Resume divorce plan" : "Start divorce plan"}
        </Link>
      </div>
    </section>
  );
}
