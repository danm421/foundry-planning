// src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts
//
// Prints exactly the Balance Sheet view the advisor has on screen: same data
// (loadBalanceSheetReport), same models (report-model.ts), same selection —
// ?view=household|entities, ?asOf=today|eoy (+ ?year for eoy), ?filter for the
// By Entity tab's All / Trusts / Businesses toggle, and ?scenario.
import { NextRequest, NextResponse } from "next/server";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { recordCompletedRun } from "@/lib/crm/generation-runs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { checkExportPdfRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import {
  BalanceSheetPdfDocument,
  type BalanceSheetPdfView,
} from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import {
  agesLabel,
  BALANCE_SHEET_TABS,
  buildEntityGroups,
  buildHouseholdModels,
  resolveAsOf,
  type BalanceSheetTab,
} from "@/components/balance-sheet-report/report-model";
import type { AsOfSelection } from "@/components/balance-sheet-report/year-picker";
import { loadBalanceSheetReport } from "@/lib/balance-sheet/load-report";
import {
  ENTITY_FILTERS,
  entityFilterApplies,
  filterEntityGroups,
  prepareEntityGroups,
  type EntityFilter,
} from "@/lib/balance-sheet/entity-groups";
import { householdBrand } from "@/lib/branding/brand-choice";
import { resolveBrandingForClient } from "@/lib/branding/resolve-for-client";
import { slugForFilename } from "@/lib/filename-slug";

export const dynamic = "force-dynamic";
// Defense-in-depth on top of the 25 s render-timeout race below: cap the
// whole route well below Vercel's default (300 s) so a pathological
// projection can't pin a function instance for minutes.
export const maxDuration = 60;

const FILTER_LABELS: Record<EntityFilter, string> = { all: "All", trusts: "Trusts", businesses: "Businesses" };

function oneOf<T extends string>(valid: readonly T[], raw: string | null, fallback: T): T | null {
  if (raw == null) return fallback;
  return (valid as readonly string[]).includes(raw) ? (raw as T) : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { client, firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const rl = await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    const url = new URL(request.url);
    const tab = oneOf<BalanceSheetTab>(BALANCE_SHEET_TABS, url.searchParams.get("view"), "household");
    const asOfParam = oneOf(["today", "eoy"] as const, url.searchParams.get("asOf"), "today");
    const filter = oneOf<EntityFilter>(ENTITY_FILTERS, url.searchParams.get("filter"), "all");
    const scenarioParam = url.searchParams.get("scenario");
    if (tab == null) return NextResponse.json({ error: "Invalid view" }, { status: 400 });
    if (asOfParam == null) return NextResponse.json({ error: "Invalid asOf" }, { status: 400 });
    if (filter == null) return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
    const yearParam = url.searchParams.get("year");
    const year = Number(yearParam);
    // Cheap shape check first; whether the plan covers the year needs the load.
    if (asOfParam === "eoy" && (!yearParam || !Number.isInteger(year))) {
      return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    }

    const [{ report, scenarioName, primaryContact }, branding] = await Promise.all([
      loadBalanceSheetReport(id, firmId, client.crmHouseholdId, scenarioParam),
      resolveBrandingForClient(firmId, householdBrand(client)),
    ]);

    if (asOfParam === "eoy" && !report.selectableYears.includes(year)) {
      return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    }
    const asOf: AsOfSelection = asOfParam === "today" ? { mode: "today" } : { mode: "eoy", year };
    const { selectedYear, asOfMode } = resolveAsOf(report.selectableYears, asOf);

    let view: BalanceSheetPdfView;
    let viewLabel: string;
    if (tab === "household") {
      const { household, consolidated } = buildHouseholdModels(report, selectedYear, asOfMode);
      view = {
        kind: "household",
        household,
        donut: consolidated.donut,
        outOfEstate: consolidated,
        clientLabel: report.clientLabel,
        spouseLabel: report.spouseLabel,
      };
      viewLabel = "Household";
    } else {
      const groups = prepareEntityGroups(buildEntityGroups(report, selectedYear, asOfMode));
      const filtered = filter !== "all" && entityFilterApplies(groups);
      view = { kind: "entities", groups: filterEntityGroups(groups, filter), trustDetails: report.trustDetails ?? [] };
      viewLabel = filtered ? `By Entity · ${FILTER_LABELS[filter]}` : "By Entity";
    }

    // The year picker's "Today (2026)" and ages, spelled out for print.
    const ages = report.agesByYear?.[selectedYear];
    const subtitle = [
      viewLabel,
      asOfMode === "today" ? `Today (${new Date().getFullYear()})` : `End of ${selectedYear}`,
      ages ? `${ages.spouse != null ? "Ages" : "Age"} ${agesLabel(ages)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const clientName = [primaryContact?.firstName, primaryContact?.lastName].filter(Boolean).join(" ") || "Client";
    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const doc = React.createElement(BalanceSheetPdfDocument, {
      clientName,
      subtitle,
      scenarioName,
      generatedAt,
      firmName: branding.firmName,
      logoDataUrl: branding.logoDataUrl,
      accentColor: branding.primaryColor,
      view,
    }) as React.ReactElement<DocumentProps>;

    const buffer = await Promise.race<Buffer>([
      renderToBuffer(doc),
      new Promise<Buffer>((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    const downloadName = `balance-sheet-${slugForFilename(primaryContact?.lastName ?? "client")}-${
      asOfMode === "today" ? "today" : selectedYear
    }${tab === "entities" ? "-entities" : ""}.pdf`;

    const vaultDoc = await savePlanToVault({
      clientId: id,
      firmId,
      reportType: "balance_sheet",
      scenarioId: scenarioParam,
      filename: downloadName,
      buffer,
    });
    try {
      const householdId = client.crmHouseholdId;
      if (householdId) {
        const { userId } = await auth();
        const u = await currentUser().catch(() => null);
        await recordCompletedRun({
          clientId: id,
          householdId,
          firmId,
          kind: "balance_sheet",
          scenarioId: scenarioParam ?? null,
          triggeredBy: userId ?? null,
          triggeredByEmail: u?.emailAddresses?.[0]?.emailAddress ?? null,
          resultDocumentId: vaultDoc?.id ?? null,
        });
      }
    } catch (err) {
      console.error("[balance-sheet-report] run log failed (non-fatal)", err);
    }

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST balance-sheet export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
