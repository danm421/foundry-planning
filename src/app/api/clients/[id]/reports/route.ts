// src/app/api/clients/[id]/reports/route.ts
//
// GET  → list reports for a client (org-scoped via client→firm).
// POST → create a new report from a template (or "blank" for an empty
//        pages array). Templates are stubbed in v1 — Task 31 lands the
//        real ones, so a non-"blank" template currently 400s.
//
// Auth model:
// - `requireOrgId` returns the caller's firm id (401 if no Clerk org).
// - The client lookup with `firmId` predicate is the org-scope gate —
//   404 if the client doesn't belong to the caller's firm. Same pattern
//   as the wills/scenarios routes.
// - POST also pulls `userId` from `auth()` for `createdByUserId`. The
//   reports schema requires this column.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, reports, scenarios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { TEMPLATES } from "@/lib/reports/templates";
import { cloneTemplateWithFreshIds } from "@/lib/reports/clone-template";
import type { Page } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  template: z.enum([
    "blank",
    "annualReview",
    "retirementRoadmap",
    "currentFinancialCondition",
    "currentVsProposed",
  ]),
  title: z.string().min(1).max(200),
  // Two-scenario binding for plan-comparison reports. Both ids (when present)
  // must reference scenarios belonging to this client; the route enforces
  // that before persisting. Phase 6 of the ethos-style-reports plan adds the
  // template options that actually require this; the field is accepted now
  // so the data layer is in place ahead of UI.
  comparisonBinding: z
    .object({
      currentScenarioId: z.string().uuid(),
      proposedScenarioId: z.string().uuid(),
    })
    .nullish(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        id: reports.id,
        title: reports.title,
        templateKey: reports.templateKey,
        updatedAt: reports.updatedAt,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(and(eq(reports.clientId, id), eq(reports.firmId, firmId)))
      .orderBy(desc(reports.updatedAt));

    return NextResponse.json({ reports: rows });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("GET /api/clients/[id]/reports error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = CreateBody.parse(await request.json());

    let pages: Page[];
    let templateKey: string | null = null;
    if (body.template === "blank") {
      pages = [];
    } else {
      const tmpl = TEMPLATES.find((t) => t.key === body.template);
      if (!tmpl) {
        return NextResponse.json(
          { error: "Unknown template" },
          { status: 400 },
        );
      }
      pages = cloneTemplateWithFreshIds(tmpl).pages;
      templateKey = tmpl.key;
    }

    // Validate the comparison binding's scenarios both belong to this client.
    // Cheaper than two single-row queries: one IN-list lookup and a count check.
    if (body.comparisonBinding) {
      const ids = [
        body.comparisonBinding.currentScenarioId,
        body.comparisonBinding.proposedScenarioId,
      ];
      const found = await db
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(and(inArray(scenarios.id, ids), eq(scenarios.clientId, id)));
      if (found.length !== new Set(ids).size) {
        return NextResponse.json(
          { error: "Invalid scenario binding" },
          { status: 400 },
        );
      }
    }

    const [row] = await db
      .insert(reports)
      .values({
        firmId,
        clientId: id,
        title: body.title,
        templateKey,
        pages,
        comparisonBinding: body.comparisonBinding ?? null,
        createdByUserId: userId,
      })
      .returning();

    await recordAudit({
      action: "report.create",
      resourceType: "report",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: { templateKey },
    });

    return NextResponse.json({ report: row }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/reports error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
