// src/app/api/clients/[id]/solver/project/route.ts
//
// POST /api/clients/[id]/solver/project
//
// Deterministic recompute endpoint for the Live Solver. Fired on every
// debounced edit. Read-only — no audit row.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runProjection } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import type { SolverMutation, SolverProjectResponse } from "@/lib/solver/types";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";

export const dynamic = "force-dynamic";

const PERSON = z.enum(["client", "spouse"]);
const MUTATION = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("retirement-age"),
    person: PERSON,
    age: z.number().int().min(40).max(85),
    month: z.number().int().min(1).max(12).optional(),
  }),
  z.object({
    kind: z.literal("living-expense-scale"),
    multiplier: z.number().min(0.1).max(3),
  }),
  z.object({
    kind: z.literal("ss-claim-age"),
    person: PERSON,
    age: z.number().int().min(62).max(70),
  }),
  z.object({
    kind: z.literal("savings-contribution"),
    accountId: z.string().uuid(),
    annualAmount: z.number().min(0).max(10_000_000),
  }),
  z.object({
    kind: z.literal("life-expectancy"),
    person: PERSON,
    age: z.number().int().min(60).max(120),
  }),
]);

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(MUTATION),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await ctx.params;

    const inFirm = await findClientInFirm(clientId, firmId);
    if (!inFirm) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const raw = await req.json();
    const parsed = BODY.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { source, mutations } = parsed.data;

    const { effectiveTree } = await loadEffectiveTree(
      clientId,
      firmId,
      source,
      {},
    );
    const mutated = applyMutations(effectiveTree, mutations as SolverMutation[]);
    const projection = runProjection(mutated);

    const body: SolverProjectResponse = { projection };
    return NextResponse.json(body);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/solver/project error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
