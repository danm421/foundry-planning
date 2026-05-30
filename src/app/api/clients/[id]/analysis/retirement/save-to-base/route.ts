// src/app/api/clients/[id]/analysis/retirement/save-to-base/route.ts
//
// POST /api/clients/[id]/analysis/retirement/save-to-base
//
// Commits a set of retirement-analysis "Explore" mutations into the client's
// BASE entity rows (plan of record), rather than into a new scenario. Only the
// five base-writable mutation kinds are applied (see mutationsToBaseUpdates);
// everything else — notably `retirement-age` — is reported back as `skipped`.
//
// Every UPDATE is scoped by BOTH clientId (org isolation) AND the client's
// base-case scenario id, so an overlay row belonging to a non-base scenario
// can never be touched. The whole batch runs in one transaction.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { incomes, expenses, savingsRules, scenarios } from "@/db/schema";
import type { SolverMutation } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { mutationsToBaseUpdates } from "@/lib/analysis/mutations-to-base-updates";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA).min(1),
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

    // Base-facts writes always target the base case. Load the base tree to
    // resolve mutation targets (SS row by person, savings rule by accountId),
    // and fetch the base scenario id to scope every UPDATE.
    const [{ effectiveTree: baseTree }, baseScenarioRows] = await Promise.all([
      loadEffectiveTree(clientId, firmId, "base", {}),
      db
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true))),
    ]);

    const baseScenarioId = baseScenarioRows[0]?.id;
    if (!baseScenarioId) {
      return NextResponse.json(
        { error: "Client has no base case scenario" },
        { status: 409 },
      );
    }

    const { updates, skipped } = mutationsToBaseUpdates(
      baseTree,
      mutations as SolverMutation[],
    );

    if (updates.length > 0) {
      await db.transaction(async (tx) => {
        for (const u of updates) {
          // `annualAmount` is a Postgres decimal — Drizzle expects a string.
          // `endYear` is an integer — keep it a number.
          if (u.table === "incomes") {
            const set =
              u.field === "endYear"
                ? { endYear: u.value }
                : { annualAmount: String(u.value) };
            await tx
              .update(incomes)
              .set(set)
              .where(
                and(
                  eq(incomes.id, u.id),
                  eq(incomes.clientId, clientId),
                  eq(incomes.scenarioId, baseScenarioId),
                ),
              );
          } else if (u.table === "expenses") {
            await tx
              .update(expenses)
              .set({ annualAmount: String(u.value) })
              .where(
                and(
                  eq(expenses.id, u.id),
                  eq(expenses.clientId, clientId),
                  eq(expenses.scenarioId, baseScenarioId),
                ),
              );
          } else {
            await tx
              .update(savingsRules)
              .set({ annualAmount: String(u.value) })
              .where(
                and(
                  eq(savingsRules.id, u.id),
                  eq(savingsRules.clientId, clientId),
                  eq(savingsRules.scenarioId, baseScenarioId),
                ),
              );
          }
        }
      });
    }

    await recordAudit({
      action: "client.base_facts.update",
      resourceType: "client",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: {
        source: "retirement-analysis",
        requestSource: source,
        appliedCount: updates.length,
        skipped,
      },
    });

    return NextResponse.json({ appliedCount: updates.length, skipped });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "POST /api/clients/[id]/analysis/retirement/save-to-base error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
