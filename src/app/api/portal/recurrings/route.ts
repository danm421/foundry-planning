import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recurringTransactions, transactionCategories, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordCreate } from "@/lib/audit/record-helpers";
import { claimRecurringRetroactively } from "@/lib/portal/claim-recurring";
import { loadRecurringsData } from "@/lib/portal/load-recurrings-data";

export const dynamic = "force-dynamic";

type Body = {
  name?: string;
  matchType?: string;
  pattern?: string;
  amountMin?: number;
  amountMax?: number;
  cadence?: string;
  dueDay?: number | null;
  dueMonth?: number | null;
  categoryId?: string;
};

export async function GET(): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    const data = await loadRecurringsData(clientId, new Date());
    return NextResponse.json(data);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const body = (await req.json().catch(() => ({}))) as Body;

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    if (body.matchType !== "exact" && body.matchType !== "contains") {
      return NextResponse.json({ error: "invalid matchType" }, { status: 400 });
    }
    if (!body.pattern || !body.pattern.trim()) {
      return NextResponse.json({ error: "pattern required" }, { status: 400 });
    }
    if (body.cadence !== "monthly" && body.cadence !== "annually") {
      return NextResponse.json({ error: "invalid cadence" }, { status: 400 });
    }
    const amountMin = Number(body.amountMin);
    const amountMax = Number(body.amountMax);
    if (!Number.isFinite(amountMin) || !Number.isFinite(amountMax) || amountMin > amountMax) {
      return NextResponse.json({ error: "invalid amount range" }, { status: 400 });
    }
    if (!body.categoryId) {
      return NextResponse.json({ error: "categoryId required" }, { status: 400 });
    }
    const [[cat], [clientRow]] = await Promise.all([
      db
        .select({ clientId: transactionCategories.clientId, kind: transactionCategories.kind })
        .from(transactionCategories)
        .where(eq(transactionCategories.id, body.categoryId))
        .limit(1),
      db
        .select({ firmId: clients.firmId })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1),
    ]);
    if (!cat || cat.clientId !== clientId || cat.kind !== "category") {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    const firmId = clientRow?.firmId ?? null;
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const dueDay =
      body.cadence === "monthly" && typeof body.dueDay === "number" ? body.dueDay : null;
    const dueMonth =
      body.cadence === "annually" && typeof body.dueMonth === "number" ? body.dueMonth : null;

    const [row] = await db
      .insert(recurringTransactions)
      .values({
        clientId,
        name: body.name.trim(),
        matchType: body.matchType,
        pattern: body.pattern.trim(),
        amountMin: amountMin.toFixed(2),
        amountMax: amountMax.toFixed(2),
        cadence: body.cadence,
        dueDay,
        dueMonth,
        categoryId: body.categoryId,
      })
      .returning({ id: recurringTransactions.id });

    const claimed = await claimRecurringRetroactively(clientId, {
      id: row.id, matchType: body.matchType, pattern: body.pattern.trim(),
      amountMin, amountMax, categoryId: body.categoryId,
    });

    await recordCreate({
      action: "portal.recurring.create",
      resourceType: "recurring_transaction",
      resourceId: row.id,
      clientId, firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: { name: body.name.trim(), pattern: body.pattern.trim(), cadence: body.cadence, claimed },
    });

    return NextResponse.json({ id: row.id, claimed });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
