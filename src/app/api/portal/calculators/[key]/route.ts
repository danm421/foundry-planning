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
import {
  createDefaultSavingsGoalState,
  validateSavingsGoalState,
} from "@/lib/calculators/savings-goal-state";

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

/**
 * Every calculator this route will store, with the validator that judges its
 * payload and the default it hands back when nothing is saved yet.
 *
 * A registry rather than an allowlist plus a hardcoded validator: the route
 * used to check the key and then call `validateDebtPaydownState` regardless,
 * which was correct only while there was one entry. A second calculator would
 * have had every save judged by the first one's rules, and no existing test
 * would have caught it — each only ever exercised its own key.
 *
 * A `Map`, not an object literal, because `key` is caller-controlled: a plain
 * object answers truthily for `constructor`, `toString` and `__proto__`, so an
 * object registry would need a `hasOwnProperty` guard to keep 404ing. A Map
 * has no prototype chain to walk.
 */
interface CalculatorSpec {
  validate: (raw: unknown) => { ok: true; state: unknown } | { ok: false; error: string };
  createDefault: () => unknown;
}

const CALCULATORS = new Map<string, CalculatorSpec>([
  [
    "debt-paydown",
    { validate: validateDebtPaydownState, createDefault: createDefaultDebtPaydownState },
  ],
  [
    "savings-goal",
    { validate: validateSavingsGoalState, createDefault: createDefaultSavingsGoalState },
  ],
]);

const notFound = (): Response =>
  NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await ctx.params;
    const calculator = CALCULATORS.get(key);
    if (!calculator) return notFound();

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

    const parsed = row ? calculator.validate(row.state) : null;
    return NextResponse.json({
      state: parsed?.ok ? parsed.state : calculator.createDefault(),
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
    const calculator = CALCULATORS.get(key);
    if (!calculator) return notFound();

    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requirePortalFeature(clientId, "calculators");

    const body = (await req.json().catch(() => ({}))) as { state?: unknown };
    // Rebuilt field by field, never spread — a jsonb column is the easiest
    // place in this codebase to reintroduce mass assignment.
    const parsed = calculator.validate(body.state);
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
