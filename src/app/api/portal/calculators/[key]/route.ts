import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { portalCalculatorStates } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { requirePortalFeature } from "@/lib/portal/load-features";
import {
  createDefaultDebtPaydownState,
  validateDebtPaydownState,
} from "@/lib/calculators/debt-paydown-state";

export const dynamic = "force-dynamic";

/**
 * The client's saved setup for one portal calculator.
 *
 * Guarded by the portal identity gate, the subscription and the advisor's
 * Calculators switch — but NOT by `requireEditEnabled`. That switch governs
 * whether a client may change their plan data; this row is a scratchpad, and a
 * read-only portal client should still be able to run the numbers.
 *
 * No audit row per save either: this autosaves as the client types, and
 * flooding the trail with scratchpad writes would dilute the plan-data changes
 * it exists to record.
 */
const CALCULATOR_KEYS = ["debt-paydown"] as const;

function isCalculatorKey(value: string): value is (typeof CALCULATOR_KEYS)[number] {
  return (CALCULATOR_KEYS as readonly string[]).includes(value);
}

const notFound = (): Response =>
  NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await ctx.params;
    if (!isCalculatorKey(key)) return notFound();

    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requirePortalFeature(clientId, "calculators");

    const [row] = await db
      .select({ state: portalCalculatorStates.state })
      .from(portalCalculatorStates)
      .where(
        and(
          eq(portalCalculatorStates.clientId, clientId),
          eq(portalCalculatorStates.calculatorKey, key),
        ),
      )
      .limit(1);

    const parsed = row ? validateDebtPaydownState(row.state) : null;
    return NextResponse.json({
      state: parsed?.ok ? parsed.state : createDefaultDebtPaydownState(),
    });
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw e;
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await ctx.params;
    if (!isCalculatorKey(key)) return notFound();

    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requirePortalFeature(clientId, "calculators");

    const body = (await req.json().catch(() => ({}))) as { state?: unknown };
    // Rebuilt field by field, never spread — a jsonb column is the easiest
    // place in this codebase to reintroduce mass assignment.
    const parsed = validateDebtPaydownState(body.state);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    await db
      .insert(portalCalculatorStates)
      .values({ clientId, calculatorKey: key, state: parsed.state })
      .onConflictDoUpdate({
        target: [portalCalculatorStates.clientId, portalCalculatorStates.calculatorKey],
        set: { state: parsed.state, updatedAt: new Date() },
      });

    return NextResponse.json({ state: parsed.state });
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw e;
  }
}
