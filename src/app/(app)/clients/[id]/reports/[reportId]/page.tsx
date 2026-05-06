// src/app/(app)/clients/[id]/reports/[reportId]/page.tsx
//
// Server component for the report builder. Loads the report (firm-scoped
// via the parent client) and hands the initial title + pages to the
// `Builder` client component.

import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, reports, scenarios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { Builder, type ComparisonBindingDisplay } from "@/components/reports/builder";
import type { Household } from "@/components/reports/builder-context";
import { loadReportWidgetData } from "@/lib/reports/load-widget-data";
import type { ComparisonBinding, Page } from "@/lib/reports/types";

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

  // Compute household context. retirementYear is birthYear + retirementAge
  // (calendar year the primary client retires); Task 31 will refine this with
  // plan_settings.
  const birthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const household: Household = {
    primaryClientId: id,
    retirementYear: birthYear + (client.retirementAge ?? 67),
    currentYear: new Date().getFullYear(),
  };

  const householdName =
    [client.firstName, client.lastName].filter(Boolean).join(" ") || "Client";

  // Pre-resolve per-widget data on the server so the on-screen canvas
  // renders real charts (the PDF route runs the same loader so screen and
  // PDF stay in sync). When the report binds two scenarios, also load the
  // comparison scope so Phase-5 comparison-aware widgets see both sides.
  const pages = report.pages as Page[];
  const widgetData = await loadReportWidgetData({
    clientId: id,
    firmId,
    pages,
    dateOfBirth: client.dateOfBirth,
    retirementAge: client.retirementAge,
    comparisonBinding: report.comparisonBinding,
  });

  // Resolve scenario display names for the comparison banner. The binding
  // ids were validated to belong to this client at creation time; we still
  // re-scope the lookup by clientId here as a defense-in-depth check.
  const binding = report.comparisonBinding as ComparisonBinding | null;
  let comparisonBindingDisplay: ComparisonBindingDisplay | null = null;
  if (binding) {
    const scenarioRows = await db
      .select({ id: scenarios.id, name: scenarios.name })
      .from(scenarios)
      .where(
        and(
          eq(scenarios.clientId, id),
          inArray(scenarios.id, [
            binding.currentScenarioId,
            binding.proposedScenarioId,
          ]),
        ),
      );
    const byId = new Map(scenarioRows.map((r) => [r.id, r.name]));
    comparisonBindingDisplay = {
      currentScenarioId: binding.currentScenarioId,
      proposedScenarioId: binding.proposedScenarioId,
      currentScenarioName: byId.get(binding.currentScenarioId) ?? "Current",
      proposedScenarioName: byId.get(binding.proposedScenarioId) ?? "Proposed",
    };
  }

  return (
    <Builder
      reportId={report.id}
      clientId={id}
      household={household}
      householdName={householdName}
      widgetData={widgetData}
      comparisonBinding={comparisonBindingDisplay}
      initial={{
        title: report.title,
        pages: report.pages as never,
      }}
    />
  );
}
