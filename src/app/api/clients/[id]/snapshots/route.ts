// src/app/api/clients/[id]/snapshots/route.ts
//
// POST → freeze the current (left, right) compare pair into a scenario_snapshot
//        row. Body carries the URL-shaped left/right side strings ("base",
//        "<scenarioId>", or "snap:<id>") plus the right-side toggle state; the
//        route reconstructs `ScenarioRef`s server-side via `refFromString`
//        before handing off to the `createSnapshot` writer (Task 35). Snapshot
//        rows survive scenario deletion per spec §3.1.
// GET  → list snapshots for the client (id, name, sourceKind, frozenAt). Used
//        by the snapshot picker dropdown and Task 37 admin views; not strictly
//        required by Task 36's spec but cheap to ship alongside.
//
// Auth model mirrors `scenarios/route.ts`: `requireOrgId` for the firm id +
// `findClientInFirm` for the org-scope gate (404 on cross-firm probe). The
// snapshot table has no firmId column — scoping inherits via the parent client.
//
// Userid wiring: `requireOrgId` only returns the firm id, but the snapshot row
// records `frozenByUserId` for SOC-2 attribution. Pull the userId from
// `auth()` directly. `recordAudit` does the same internally for `actorId`.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { scenarioSnapshots } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { createSnapshot } from "@/lib/scenario/snapshot";
import { refFromString } from "@/lib/scenario/scenario-from-search-params";

export const dynamic = "force-dynamic";

const POST_BODY = z.object({
  // URL-shaped side strings: "base" | "<scenarioId>" | "snap:<snapId>". The
  // route resolves these to `ScenarioRef` objects via `refFromString` so the
  // wire format matches exactly what the compare URL already encodes.
  left: z.string().min(1),
  right: z.string().min(1),
  // Toggle group ids → enabled flag. Only the right side honors this; matches
  // the URL parser's contract.
  toggleState: z.record(z.string(), z.boolean()).default({}),
  name: z.string().min(1).max(120).regex(/\S/, "name must not be empty"),
  description: z.string().max(500).optional(),
  // `pdf_export` is reserved for the report-render path; the in-app
  // "Snapshot for presentation" button always sends "manual".
  sourceKind: z.enum(["manual", "pdf_export"]).default("manual"),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await ctx.params;

    const inFirm = await findClientInFirm(clientId, firmId);
    if (!inFirm) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 },
      );
    }

    const rows = await db
      .select({
        id: scenarioSnapshots.id,
        name: scenarioSnapshots.name,
        sourceKind: scenarioSnapshots.sourceKind,
        frozenAt: scenarioSnapshots.frozenAt,
      })
      .from(scenarioSnapshots)
      .where(eq(scenarioSnapshots.clientId, clientId))
      .orderBy(desc(scenarioSnapshots.frozenAt));

    return NextResponse.json({ snapshots: rows });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("GET /api/clients/[id]/snapshots error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    // `requireOrgId` already guarantees a userId in its own auth() call, but
    // we re-check defensively — the typed `auth()` return is `userId | null`.
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id: clientId } = await ctx.params;

    const inFirm = await findClientInFirm(clientId, firmId);
    if (!inFirm) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 },
      );
    }

    const parsed = POST_BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { left, right, toggleState, name, description, sourceKind } =
      parsed.data;

    // Refuse to freeze a no-op (left === right) — the compare panel's button
    // is disabled in that state, but a hand-crafted POST shouldn't slip past.
    // 400, not 422, to match other body-validation rejections.
    if (left === right) {
      return NextResponse.json(
        { error: "left and right must differ" },
        { status: 400 },
      );
    }

    const leftRef = refFromString(left, toggleState, "left");
    const rightRef = refFromString(right, toggleState, "right");

    const snapshot = await createSnapshot({
      clientId,
      firmId,
      leftRef,
      rightRef,
      name,
      description,
      sourceKind,
      userId,
    });

    await recordAudit({
      action: "snapshot.create",
      resourceType: "scenario_snapshot",
      resourceId: snapshot.id,
      clientId,
      firmId,
      metadata: { name, sourceKind, left, right },
    });

    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/snapshots error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
