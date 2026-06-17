import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  familyMembers,
  stockOptionAccounts,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { stockOptionAccountUpdateSchema } from "@/lib/schemas/stock-options";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/stock-option-accounts/[accountId]
// Partial update of a stock-option account (accounts row + owner + extension).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    // Verify client belongs to this firm (+ staff scope).
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    // Tenant-isolation: confirm target account exists, belongs to this client,
    // and is a stock-options account.
    const [target] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.clientId, id),
          eq(accounts.category, "stock_options"),
        ),
      );
    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = stockOptionAccountUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const input = parsed.data;

    // Look up FM ids for potential owner replacement.
    const fmRows = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id));
    const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
    const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;

    await db.transaction(async (tx) => {
      // --- accounts row ---
      const acctUpdates: Record<string, unknown> = {};
      if (input.name !== undefined) acctUpdates.name = input.name;
      if (input.growthRate !== undefined) {
        acctUpdates.growthRate = input.growthRate != null ? String(input.growthRate) : null;
      }
      if (Object.keys(acctUpdates).length > 0) {
        acctUpdates.updatedAt = new Date();
        await tx
          .update(accounts)
          .set(acctUpdates)
          .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
      }

      // --- account_owners: full replacement when owner is provided ---
      // Mirrors the insurance route: if the requested owner's family member
      // doesn't exist (e.g. owner "spouse" but no spouse on file), the row is
      // left ownerless rather than synthesizing a bogus owner.
      if (input.owner !== undefined) {
        await tx.delete(accountOwners).where(eq(accountOwners.accountId, accountId));
        const ownerFmId = input.owner === "spouse" ? spouseFmId : clientFmId;
        if (ownerFmId != null) {
          await tx.insert(accountOwners).values({
            accountId,
            familyMemberId: ownerFmId,
            percent: "1",
          });
        }
      }

      // --- stockOptionAccounts extension row ---
      const extUpdates: Record<string, unknown> = {};
      if (input.ticker !== undefined) extUpdates.ticker = input.ticker ?? null;
      if (input.isPublic !== undefined) extUpdates.isPublic = input.isPublic;
      if (input.pricePerShare !== undefined) {
        extUpdates.pricePerShare = String(input.pricePerShare);
      }
      if (input.destinationAccountId !== undefined) {
        extUpdates.destinationAccountId = input.destinationAccountId ?? null;
      }
      if (input.autoCreateDestination !== undefined) {
        extUpdates.autoCreateDestination = input.autoCreateDestination;
      }
      if (input.sellToCover !== undefined) extUpdates.sellToCover = input.sellToCover;
      if (input.withholdingRate !== undefined) {
        extUpdates.withholdingRate = String(input.withholdingRate);
      }
      if (input.defaultExerciseTiming !== undefined) {
        extUpdates.defaultExerciseTiming = input.defaultExerciseTiming;
      }
      if (input.defaultExerciseYear !== undefined) {
        extUpdates.defaultExerciseYear = input.defaultExerciseYear ?? null;
      }
      if (input.defaultSellTiming !== undefined) {
        extUpdates.defaultSellTiming = input.defaultSellTiming;
      }
      if (input.defaultSellYear !== undefined) {
        extUpdates.defaultSellYear = input.defaultSellYear ?? null;
      }
      if (input.defaultSellPercentPerYear !== undefined) {
        extUpdates.defaultSellPercentPerYear =
          input.defaultSellPercentPerYear != null
            ? String(input.defaultSellPercentPerYear)
            : null;
      }
      if (input.defaultSellStartYear !== undefined) {
        extUpdates.defaultSellStartYear = input.defaultSellStartYear ?? null;
      }
      if (Object.keys(extUpdates).length > 0) {
        extUpdates.updatedAt = new Date();
        await tx
          .update(stockOptionAccounts)
          .set(extUpdates)
          .where(eq(stockOptionAccounts.accountId, accountId));
      }
    });

    await recordAudit({
      action: "account.stock_options.update",
      resourceType: "stock_option_account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: { name: target.name, fieldsChanged: Object.keys(input) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "PUT /api/clients/[id]/stock-option-accounts/[accountId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/stock-option-accounts/[accountId]
// Deletes the accounts row; FK cascades handle extension + grants/tranches/events.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    // Verify client belongs to this firm (+ staff scope).
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    // Tenant-isolation: same guard as PUT.
    const [target] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.clientId, id),
          eq(accounts.category, "stock_options"),
        ),
      );
    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    await db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));

    await recordAudit({
      action: "account.stock_options.delete",
      resourceType: "stock_option_account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: { name: target.name ?? null },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "DELETE /api/clients/[id]/stock-option-accounts/[accountId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
