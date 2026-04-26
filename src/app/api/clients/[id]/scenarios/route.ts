// src/app/api/clients/[id]/scenarios/route.ts
//
// GET  → list scenarios for a client (org-scoped via client→firm).
// POST → create a new scenario, optionally cloning toggle groups + changes
//        from the client's base case or another scenario in the same client.
//
// Auth model:
// - `requireOrgId` returns the caller's firm id (401 if no Clerk org).
// - `findClientInFirm` is the org-scope gate — 404 if the client doesn't
//   belong to the caller's firm. Same pattern as Task 3's changes route so
//   leaked client ids can't be probed across firms.
// - On POST with `copyFrom` = explicit scenario uuid, we re-verify the source
//   scenario lives under the same client before passing to the clone helper.
//
// Note: the `scenarios` row has no firm_id column; org scoping flows through
// `clients.firm_id`. The plan's example incorrectly inserted a `firmId` on
// the scenarios row — omitted here.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import {
  createScenarioWithClone,
  type CreateWithCloneSource,
} from "@/lib/scenario/create-with-clone";

export const dynamic = "force-dynamic";

const CREATE = z.object({
  name: z.string().min(1).max(60).regex(/\S/, "name must not be empty"),
  // `copyFrom` accepts the literal string "base" (the client's base-case
  // scenario), "empty" (no clone — fresh scenario with no changes/groups),
  // or a uuid pointing at another scenario in the same client to duplicate.
  copyFrom: z
    .union([z.literal("base"), z.literal("empty"), z.string().uuid()])
    .default("empty"),
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
      .select()
      .from(scenarios)
      .where(eq(scenarios.clientId, clientId));

    return NextResponse.json({ scenarios: rows });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("GET /api/clients/[id]/scenarios error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
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

    const parsed = CREATE.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { name, copyFrom } = parsed.data;

    // Resolve `copyFrom` into the helper's discriminated union. When it's a
    // uuid, verify the source scenario belongs to this client *before* the
    // helper opens its transaction — keeps cross-client probing out of the
    // tx and gives a clean 404 on miss.
    let source: CreateWithCloneSource;
    if (copyFrom === "empty") {
      source = { kind: "empty" };
    } else if (copyFrom === "base") {
      source = { kind: "base" };
    } else {
      const [src] = await db
        .select({ id: scenarios.id, clientId: scenarios.clientId })
        .from(scenarios)
        .where(eq(scenarios.id, copyFrom));
      if (!src || src.clientId !== clientId) {
        return NextResponse.json(
          { error: "Source scenario not found" },
          { status: 404 },
        );
      }
      source = { kind: "scenario", sourceId: copyFrom };
    }

    const { scenario } = await createScenarioWithClone({
      clientId,
      name,
      source,
    });

    await recordAudit({
      action: "scenario.create",
      resourceType: "scenario",
      resourceId: scenario.id,
      clientId,
      firmId,
      metadata: { name, copyFrom },
    });

    return NextResponse.json({ scenario }, { status: 201 });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/scenarios error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
