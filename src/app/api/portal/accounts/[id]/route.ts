import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  accountCategoryEnum,
  accountSubTypeEnum,
  clients,
} from "@/db/schema";
import {
  authErrorResponse,
  requireClientPortalAccess,
} from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import {
  validateOwnersShape,
  validateOwnersTenant,
  validateAccountOwnershipRules,
} from "@/lib/ownership";
import { recordUpdate, recordDelete } from "@/lib/audit/record-helpers";
import type { EntitySnapshot } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

type AccountRow = {
  id: string;
  clientId: string;
  name: string;
  category: string;
  subType: string;
  value: string;
  accountNumberLast4: string | null;
};

const ALLOWED_FIELDS = [
  "name",
  "category",
  "subType",
  "value",
  "last4",
] as const;

const FIELD_LABELS = {
  name: { label: "Name", format: "text" as const },
  category: { label: "Category", format: "text" as const },
  subType: { label: "Sub-type", format: "text" as const },
  value: { label: "Value", format: "text" as const },
  last4: { label: "Last 4", format: "text" as const },
};

async function loadOwnedRow(
  rowId: string,
  clientId: string,
): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, rowId))
    .limit(1);
  if (!row || row.clientId !== clientId) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    category: row.category,
    subType: row.subType,
    value: row.value,
    accountNumberLast4: row.accountNumberLast4,
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

function snapshot(row: AccountRow): EntitySnapshot {
  return {
    name: row.name,
    category: row.category,
    subType: row.subType,
    value: row.value,
    last4: row.accountNumberLast4,
  };
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;
    const row = await loadOwnedRow(id, clientId);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Validate enum fields when present — mirrors the family/[id] pattern
    if (
      body.category !== undefined &&
      !(accountCategoryEnum.enumValues as readonly string[]).includes(body.category as string)
    ) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    if (
      body.subType !== undefined &&
      !(accountSubTypeEnum.enumValues as readonly string[]).includes(body.subType as string)
    ) {
      return NextResponse.json({ error: "invalid subType" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const k of ALLOWED_FIELDS) {
      if (k in body) {
        if (k === "last4") {
          patch.accountNumberLast4 = body[k] ?? null;
        } else {
          patch[k] = body[k];
        }
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
      const rulesErr = validateAccountOwnershipRules(
        shapeResult.owners,
        (patch.subType ?? row.subType) as string,
        false,
      );
      if (rulesErr) {
        return NextResponse.json({ error: rulesErr.error }, { status: 400 });
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
        await tx.update(accounts).set(patch).where(eq(accounts.id, id));
      }
      if (newOwners && "owners" in newOwners) {
        await tx.delete(accountOwners).where(eq(accountOwners.accountId, id));
        for (const o of newOwners.owners) {
          await tx.insert(accountOwners).values({
            accountId: id,
            familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
            entityId: o.kind === "entity" ? o.entityId : null,
            percent: o.percent.toString(),
          });
        }
      }
    });

    const before = snapshot(row);
    const after: EntitySnapshot = { ...before, ...(patch as EntitySnapshot) };

    await recordUpdate({
      action: "portal.account.update",
      resourceType: "account",
      resourceId: id,
      clientId,
      firmId,
      actorKind: "client",
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
    const { clientId } = await requireClientPortalAccess();
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;

    const [raw] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    if (!raw || raw.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Phase 3 introduces plaid_item_id; until then the column may be absent.
    // Do NOT import plaidItems — that table doesn't exist yet.
    const plaidItemId =
      (raw as { plaidItemId?: string | null }).plaidItemId ?? null;
    if (plaidItemId) {
      return NextResponse.json(
        { error: "Unlink the institution before deleting this account" },
        { status: 409 },
      );
    }

    const firmId = await getFirmId(clientId);
    if (!firmId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row: AccountRow = {
      id: raw.id,
      clientId: raw.clientId,
      name: raw.name,
      category: raw.category,
      subType: raw.subType,
      value: raw.value,
      accountNumberLast4: raw.accountNumberLast4,
    };

    await db.transaction(async (tx) => {
      await tx.delete(accountOwners).where(eq(accountOwners.accountId, id));
      await tx.delete(accounts).where(eq(accounts.id, id));
    });

    await recordDelete({
      action: "portal.account.delete",
      resourceType: "account",
      resourceId: id,
      clientId,
      firmId,
      actorKind: "client",
      snapshot: snapshot(row),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
