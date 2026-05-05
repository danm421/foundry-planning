// src/app/api/clients/[id]/reports/[reportId]/route.ts
//
// GET    → fetch one report (org-scoped via client→firm + report.firm).
// PATCH  → update title and/or pages. Save-only (pages-without-title)
//          PATCH is the autosave path and is intentionally not audited
//          to keep the audit log readable. Title rename gets a row.
// DELETE → drop the report. Always audited.
//
// Auth model mirrors the list route: `requireOrgId` + a clients lookup
// gates the client id, and every reports query is additionally bounded
// by `firmId` so a leaked report id from another firm still 404s.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, reports } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import type { Page } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  pages: z.array(z.unknown()).optional(),
});

async function gateClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return client ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, reportId } = await params;
    if (!(await gateClient(id, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [row] = await db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, reportId),
          eq(reports.clientId, id),
          eq(reports.firmId, firmId),
        ),
      );
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ report: row });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("GET /api/clients/[id]/reports/[reportId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, reportId } = await params;
    if (!(await gateClient(id, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = PatchBody.parse(await request.json());
    const update: Partial<{ title: string; pages: Page[]; updatedAt: Date }> = {
      updatedAt: new Date(),
    };
    if (body.title !== undefined) update.title = body.title;
    if (body.pages !== undefined) update.pages = body.pages as Page[];

    const [row] = await db
      .update(reports)
      .set(update)
      .where(
        and(
          eq(reports.id, reportId),
          eq(reports.clientId, id),
          eq(reports.firmId, firmId),
        ),
      )
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Autosaves are extremely chatty — skip audit on save-only PATCH.
    // Title rename gets a row.
    if (body.title !== undefined) {
      await recordAudit({
        action: "report.rename",
        resourceType: "report",
        resourceId: row.id,
        clientId: id,
        firmId,
        metadata: { title: body.title },
      });
    }

    return NextResponse.json({ report: row });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("PATCH /api/clients/[id]/reports/[reportId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, reportId } = await params;
    if (!(await gateClient(id, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [row] = await db
      .delete(reports)
      .where(
        and(
          eq(reports.id, reportId),
          eq(reports.clientId, id),
          eq(reports.firmId, firmId),
        ),
      )
      .returning({ id: reports.id });
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await recordAudit({
      action: "report.delete",
      resourceType: "report",
      resourceId: row.id,
      clientId: id,
      firmId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("DELETE /api/clients/[id]/reports/[reportId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
