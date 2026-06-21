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
import { validateTrustOnlyEntityOwners } from "@/lib/portal/validate-trust-owners";
import { PLAID_LOCKED_FIELDS } from "@/lib/portal/plaid-locked-fields";
import { recordUpdate, recordDelete } from "@/lib/audit/record-helpers";
import type { EntitySnapshot } from "@/lib/audit/types";
import { isPortalVisibleAccount } from "@/lib/portal/account-visibility";

export const dynamic = "force-dynamic";

type AccountRow = {
  id: string;
  clientId: string;
  name: string;
  category: string;
  subType: string;
  value: string;
  accountNumberLast4: string | null;
  custodian: string | null;
  plaidItemId: string | null;
  isDefaultChecking: boolean;
  parentAccountId: string | null;
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
    custodian: (row as { custodian?: string | null }).custodian ?? null,
    plaidItemId: (row as { plaidItemId?: string | null }).plaidItemId ?? null,
    isDefaultChecking:
      (row as { isDefaultChecking?: boolean }).isDefaultChecking ?? false,
    parentAccountId:
      (row as { parentAccountId?: string | null }).parentAccountId ?? null,
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

    if (!isPortalVisibleAccount(row)) {
      return NextResponse.json(
        { error: "This account can't be edited from the portal" },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Guard Plaid-locked fields on linked accounts
    if (row.plaidItemId) {
      for (const k of Object.keys(body)) {
        if ((PLAID_LOCKED_FIELDS as readonly string[]).includes(k)) {
          return NextResponse.json(
            { error: "Cannot edit balance/last4/custodian on a Plaid-linked account" },
            { status: 400 },
          );
        }
      }
    }

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
      const trustErr = await validateTrustOnlyEntityOwners(shapeResult.owners, clientId);
      if (trustErr) {
        return NextResponse.json({ error: trustErr.error }, { status: 400 });
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
    // Build `after` in snapshot key-space (name/category/subType/value/last4),
    // NOT in DB column key-space, so the diff is labeled correctly.
    const after: EntitySnapshot = { ...before };
    if ("name" in patch) after.name = patch.name as string;
    if ("category" in patch) after.category = patch.category as string;
    if ("subType" in patch) after.subType = patch.subType as string;
    if ("value" in patch) after.value = patch.value as string;
    if ("accountNumberLast4" in patch) after.last4 = patch.accountNumberLast4 as string | null;

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

    if (
      !isPortalVisibleAccount({
        category: raw.category,
        isDefaultChecking:
          (raw as { isDefaultChecking?: boolean }).isDefaultChecking ?? false,
        parentAccountId:
          (raw as { parentAccountId?: string | null }).parentAccountId ?? null,
      })
    ) {
      return NextResponse.json(
        { error: "This account can't be deleted from the portal" },
        { status: 403 },
      );
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
      custodian: (raw as { custodian?: string | null }).custodian ?? null,
      plaidItemId,
      isDefaultChecking:
        (raw as { isDefaultChecking?: boolean }).isDefaultChecking ?? false,
      parentAccountId:
        (raw as { parentAccountId?: string | null }).parentAccountId ?? null,
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
