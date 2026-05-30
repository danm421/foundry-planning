import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  checkExportPdfRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { runProjectionWithEvents } from "@/engine/projection";
import { renderToStream } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { YearlyLiquidityPdfDocument } from "@/components/yearly-liquidity-report-pdf/document";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import type { ClientData } from "@/engine/types";
import React from "react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();

    const rl = await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // CRM contacts — sole identity source.
    const contactRows = await db
      .select()
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
    const primaryContact = contactRows.find((c) => c.role === "primary");
    const spouseContact = contactRows.find((c) => c.role === "spouse");
    if (!primaryContact?.dateOfBirth) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const clientFirstName = primaryContact.firstName;
    const clientLastName = primaryContact.lastName;
    const clientDob = primaryContact.dateOfBirth;
    const spouseFirstName = spouseContact?.firstName ?? null;
    const spouseDob = spouseContact?.dateOfBirth ?? null;

    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));

    // SSRF hardening — match balance-sheet PDF route exactly.
    const isSafePngDataUri = (v: unknown): v is string =>
      typeof v === "string" &&
      v.startsWith("data:image/png;base64,") &&
      v.length < 2_000_000;
    const chartPng: string | null = isSafePngDataUri(body.chartPng) ? body.chartPng : null;

    const apiRes = await fetch(`${url.origin}/api/clients/${id}/projection-data`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!apiRes.ok) {
      return NextResponse.json({ error: "Failed to load projection data" }, { status: 500 });
    }
    const apiData = (await apiRes.json()) as ClientData;
    const projection = runProjectionWithEvents(apiData);

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: apiData,
      ownerNames: {
        clientName: clientFirstName ?? "Client",
        spouseName: spouseFirstName ?? null,
      },
      ownerDobs: {
        clientDob,
        spouseDob: spouseDob ?? null,
      },
    });

    const clientName = [clientFirstName, clientLastName].filter(Boolean).join(" ") || "Client";
    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const doc = React.createElement(YearlyLiquidityPdfDocument, {
      clientName,
      generatedAt,
      report,
      chartPng,
    }) as React.ReactElement<DocumentProps>;

    const stream = await Promise.race<Awaited<ReturnType<typeof renderToStream>>>([
      renderToStream(doc),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="liquidity-${(clientLastName ?? "client").toLowerCase()}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST liquidity export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
