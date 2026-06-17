import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { firms, subscriptions } from "@/db/schema";

export const dynamic = "force-dynamic";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-hair py-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const [firm] = await db.select().from(firms).where(eq(firms.firmId, firmId)).limit(1);
  if (!firm) notFound();

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return (
    <div className="space-y-6">
      <section className="rounded border border-hair p-4">
        <h2 className="mb-2 text-sm font-medium text-ink-2">Organization</h2>
        <dl className="text-sm">
          <Field label="Founder">{firm.isFounder ? "Yes" : "No"}</Field>
          <Field label="Archived">{firm.archivedAt ? fmt(firm.archivedAt) : "No"}</Field>
          <Field label="Created">{fmt(firm.createdAt)}</Field>
        </dl>
      </section>

      <section className="rounded border border-hair p-4">
        <h2 className="mb-2 text-sm font-medium text-ink-2">Subscription</h2>
        {sub ? (
          <dl className="text-sm">
            <Field label="Status">{sub.status}</Field>
            <Field label="Trial ends">{fmt(sub.trialEnd)}</Field>
            <Field label="Current period end">{fmt(sub.currentPeriodEnd)}</Field>
            <Field label="Cancels at period end">{sub.cancelAtPeriodEnd ? "Yes" : "No"}</Field>
            <Field label="Stripe customer">
              <span className="tabular text-xs">{sub.stripeCustomerId}</span>
            </Field>
          </dl>
        ) : (
          <p className="text-sm text-ink-3">
            {firm.isFounder ? "Founder org — no Stripe subscription." : "No subscription on record."}
          </p>
        )}
      </section>
    </div>
  );
}
