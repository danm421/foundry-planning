import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { liabilities, liabilityOwners, liabilityTypeEnum, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { validateOwnersShape, validateOwnersTenant } from "@/lib/ownership";
import { validateTrustOnlyEntityOwners } from "@/lib/portal/validate-trust-owners";
import { LIABILITY_PLAID_LOCKED_FIELDS } from "@/lib/portal/plaid-locked-fields";
import { LOAN_SCHEDULE_START_MONTH, resolveLoanDetails } from "@/lib/portal/loan-details";
import { recordUpdate, recordDelete } from "@/lib/audit/record-helpers";
import type { EntitySnapshot } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

// Mirrors src/app/api/portal/accounts/[id]/route.ts for the debt side: the same
// resolvePortalClient + requirePortalActiveSubscription + requireEditEnabled
// guards, the same inline write (NOT the advisor liabilities-writes core, whose
// verifyClientAccess rejects a real org-less portal client), the same Plaid-lock
// + portal.* audit + viaPreview act-as tagging.

type LiabilityRow = {
  id: string;
  clientId: string;
  name: string;
  balance: string | null;
  liabilityType: string | null;
  plaidItemId: string | null;
  interestRate: string | null;
  monthlyPayment: string | null;
  termMonths: number | null;
};

const ALLOWED_FIELDS = ["name", "liabilityType", "balance"] as const;

const FIELD_LABELS = {
  name: { label: "Name", format: "text" as const },
  liabilityType: { label: "Type", format: "text" as const },
  balance: { label: "Balance", format: "text" as const },
  interestRate: { label: "Interest rate", format: "text" as const },
  monthlyPayment: { label: "Monthly payment", format: "text" as const },
  termMonths: { label: "Months to pay off", format: "text" as const },
};

async function loadOwnedRow(rowId: string, clientId: string): Promise<LiabilityRow | null> {
  const [row] = await db
    .select()
    .from(liabilities)
    .where(eq(liabilities.id, rowId))
    .limit(1);
  if (!row || row.clientId !== clientId) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    balance: row.balance,
    liabilityType: (row as { liabilityType?: string | null }).liabilityType ?? null,
    plaidItemId: (row as { plaidItemId?: string | null }).plaidItemId ?? null,
    interestRate: (row as { interestRate?: string | null }).interestRate ?? null,
    monthlyPayment: (row as { monthlyPayment?: string | null }).monthlyPayment ?? null,
    termMonths: (row as { termMonths?: number | null }).termMonths ?? null,
  };
}

async function getFirmId(clientId: string): Promise<string | null> {
  const [{ firmId } = { firmId: null as string | null }] = await db
    .select({ firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  return firmId;
}

function snapshot(row: LiabilityRow): EntitySnapshot {
  return {
    name: row.name,
    liabilityType: row.liabilityType,
    balance: row.balance,
    interestRate: row.interestRate,
    monthlyPayment: row.monthlyPayment,
    termMonths: row.termMonths,
  };
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const row = await loadOwnedRow(id, clientId);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Balance is institution-synced on a Plaid-linked debt — reject edits.
    if (row.plaidItemId) {
      for (const k of Object.keys(body)) {
        if ((LIABILITY_PLAID_LOCKED_FIELDS as readonly string[]).includes(k)) {
          return NextResponse.json(
            { error: "Cannot edit balance on a Plaid-linked debt" },
            { status: 400 },
          );
        }
      }
    }

    if (
      body.liabilityType !== undefined &&
      !(liabilityTypeEnum.enumValues as readonly string[]).includes(body.liabilityType as string)
    ) {
      return NextResponse.json({ error: "invalid liabilityType" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const k of ALLOWED_FIELDS) {
      if (k in body) patch[k] = body[k];
    }

    // Payment terms: sending them sets the payoff schedule, sending a blank
    // payment clears it back to held-flat, and omitting both keys leaves
    // whatever is stored alone. Both the balance and the type are read as they
    // will BE after this PUT, not as they were.
    if ("monthlyPayment" in body || "interestRate" in body) {
      const nextType = "liabilityType" in body ? (body.liabilityType as string) : row.liabilityType;
      const nextBalance = Number("balance" in body ? body.balance : row.balance);
      const loan = resolveLoanDetails(nextBalance, nextType, body);
      if (!loan.ok) {
        return NextResponse.json({ error: loan.error }, { status: 400 });
      }
      Object.assign(patch, loan.columns);
      if (loan.columns.termMonths != null) {
        // Restart the schedule at this year: buildLiabilitySchedule() reads the
        // stored balance as the balance at (startYear, startMonth), so leaving
        // an older start behind would run the client's REMAINING term from a
        // point in the past and understate the debt today. Clearing terms
        // deliberately does NOT stamp a start — that would overwrite an
        // advisor's real origination date on a loan the client only blanked.
        patch.startYear = new Date().getFullYear();
        patch.startMonth = LOAN_SCHEDULE_START_MONTH;
      }
    }

    let newOwners: ReturnType<typeof validateOwnersShape> | null = null;
    if ("owners" in body) {
      const shapeResult = validateOwnersShape(body.owners);
      if ("error" in shapeResult) {
        return NextResponse.json({ error: shapeResult.error }, { status: 400 });
      }
      const tenantErr = await validateOwnersTenant(shapeResult.owners, clientId);
      if (tenantErr) {
        return NextResponse.json({ error: tenantErr.error }, { status: 400 });
      }
      const trustErr = await validateTrustOnlyEntityOwners(shapeResult.owners, clientId);
      if (trustErr) {
        return NextResponse.json({ error: trustErr.error }, { status: 400 });
      }
      newOwners = shapeResult;
    }

    if (Object.keys(patch).length === 0 && !newOwners) {
      return NextResponse.json({ ok: true, noop: true });
    }

    const firmId = await getFirmId(clientId);
    if (!firmId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        await tx.update(liabilities).set(patch).where(eq(liabilities.id, id));
      }
      if (newOwners && "owners" in newOwners) {
        await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, id));
        for (const o of newOwners.owners) {
          await tx.insert(liabilityOwners).values({
            liabilityId: id,
            familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
            entityId: o.kind === "entity" ? o.entityId : null,
            percent: o.percent.toString(),
          });
        }
      }
    });

    const before = snapshot(row);
    const after: EntitySnapshot = { ...before };
    if ("name" in patch) after.name = patch.name as string;
    if ("liabilityType" in patch) after.liabilityType = patch.liabilityType as string;
    if ("balance" in patch) after.balance = patch.balance as string;
    if ("interestRate" in patch) after.interestRate = patch.interestRate as string;
    if ("monthlyPayment" in patch) after.monthlyPayment = patch.monthlyPayment as string | null;
    if ("termMonths" in patch) after.termMonths = patch.termMonths as number | null;

    await recordUpdate({
      action: "portal.liability.update",
      resourceType: "liability",
      resourceId: id,
      clientId,
      firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      before,
      after,
      fieldLabels: FIELD_LABELS,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;

    const [raw] = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.id, id))
      .limit(1);
    if (!raw || raw.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const plaidItemId = (raw as { plaidItemId?: string | null }).plaidItemId ?? null;
    if (plaidItemId) {
      return NextResponse.json(
        { error: "Unlink the institution before deleting this debt" },
        { status: 409 },
      );
    }

    const firmId = await getFirmId(clientId);
    if (!firmId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row: LiabilityRow = {
      id: raw.id,
      clientId: raw.clientId,
      name: raw.name,
      balance: raw.balance,
      liabilityType: (raw as { liabilityType?: string | null }).liabilityType ?? null,
      plaidItemId,
      interestRate: (raw as { interestRate?: string | null }).interestRate ?? null,
      monthlyPayment: (raw as { monthlyPayment?: string | null }).monthlyPayment ?? null,
      termMonths: (raw as { termMonths?: number | null }).termMonths ?? null,
    };

    await db.transaction(async (tx) => {
      await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, id));
      await tx.delete(liabilities).where(eq(liabilities.id, id));
    });

    await recordDelete({
      action: "portal.liability.delete",
      resourceType: "liability",
      resourceId: id,
      clientId,
      firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: snapshot(row),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
