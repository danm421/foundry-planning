// src/app/(app)/clients/[id]/reports/[reportId]/page.tsx
//
// Server component for the report builder. Loads the report (firm-scoped
// via the parent client) and hands the initial title + pages to the
// `Builder` client component.

import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, reports } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { Builder } from "@/components/reports/builder";
import type { Household } from "@/components/reports/builder-context";

export default async function ReportBuilderPage(
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  const firmId = await requireOrgId();
  const { id, reportId } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const [report] = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.id, reportId),
        eq(reports.clientId, id),
        eq(reports.firmId, firmId),
      ),
    );
  if (!report) notFound();

  // Compute household context. retirementAge is sourced from the client's
  // stored value for now; Task 31 will refine this with plan_settings.
  const household: Household = {
    primaryClientId: id,
    retirementAge: client.retirementAge ?? 67,
    currentYear: new Date().getFullYear(),
  };

  const householdName =
    [client.firstName, client.lastName].filter(Boolean).join(" ") || "Client";

  return (
    <Builder
      reportId={report.id}
      clientId={id}
      household={household}
      householdName={householdName}
      initial={{
        title: report.title,
        pages: report.pages as never,
      }}
    />
  );
}
