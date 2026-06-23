import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, liabilities, plaidItems, scenarios } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { mapPlaidToFoundry, mapPlaidToLiability } from "@/lib/plaid/account-mapping";
import { recordCreate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

type Decision =
  | { plaidAccountId: string; action: "skip" }
  | { plaidAccountId: string; action: "link"; existingAccountId: string }
  | { plaidAccountId: string; action: "link-liability"; existingLiabilityId: string }
  | {
      plaidAccountId: string;
      action: "create";
      accountData: {
        name: string;
        mask?: string | null;
        type: string;
        subtype: string | null;
        balance: number | null;
      };
    };

type Body = {
  itemId?: string;
  decisions?: Decision[];
};

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.itemId || !Array.isArray(body.decisions)) {
      return NextResponse.json(
        { error: "itemId and decisions required" },
        { status: 400 },
      );
    }

    // 1. Verify the Plaid item belongs to this client (tenant check).
    const [item] = await db
      .select({
        clientId: plaidItems.clientId,
        institutionName: plaidItems.institutionName,
      })
      .from(plaidItems)
      .where(eq(plaidItems.id, body.itemId))
      .limit(1);
    if (!item || item.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // 2. Look up firmId for audit.
    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // 3. Look up base scenario (needed for "create" decisions; fetched
    //    unconditionally so the dbSelect call sequence is predictable for tests
    //    and the route fails fast if the client has no base scenario at all).
    const [scenario] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
      .limit(1);
    const scenarioId = scenario?.id ?? null;

    // 4. Pre-validate every `link` decision before opening the transaction
    //    so we never leave the DB in a partially-written state.
    for (const d of body.decisions) {
      if (d.action !== "link") continue;
      const [row] = await db
        .select({
          id: accounts.id,
          clientId: accounts.clientId,
          plaidItemId: accounts.plaidItemId,
        })
        .from(accounts)
        .where(eq(accounts.id, d.existingAccountId))
        .limit(1);
      // Tenant scope: the target account must belong to this client.
      if (!row || row.clientId !== clientId) {
        return NextResponse.json(
          { error: `Account ${d.existingAccountId} not found` },
          { status: 404 },
        );
      }
      // Prevent double-linking: account must not already be linked elsewhere.
      if (row.plaidItemId) {
        return NextResponse.json(
          {
            error: `Account ${d.existingAccountId} is already linked to another institution`,
          },
          { status: 409 },
        );
      }
    }

    // 4b. Pre-validate every `link-liability` decision.
    for (const d of body.decisions) {
      if (d.action !== "link-liability") continue;
      const [row] = await db
        .select({
          id: liabilities.id,
          clientId: liabilities.clientId,
          plaidItemId: liabilities.plaidItemId,
        })
        .from(liabilities)
        .where(eq(liabilities.id, d.existingLiabilityId))
        .limit(1);
      if (!row || row.clientId !== clientId) {
        return NextResponse.json(
          { error: `Liability ${d.existingLiabilityId} not found` },
          { status: 404 },
        );
      }
      if (row.plaidItemId) {
        return NextResponse.json(
          { error: `Liability ${d.existingLiabilityId} is already linked to another institution` },
          { status: 409 },
        );
      }
    }

    // Validate that "create" decisions have a base scenario to attach to.
    const needsScenario = body.decisions.some((d) => d.action === "create");
    if (needsScenario && !scenarioId) {
      return NextResponse.json({ error: "No base scenario" }, { status: 404 });
    }

    const linkedAccountIds: string[] = [];
    let linkedCount = 0;
    let addedCount = 0;
    let skippedCount = 0;

    await db.transaction(async (tx) => {
      for (const d of body.decisions!) {
        if (d.action === "skip") {
          skippedCount += 1;
          continue;
        }

        if (d.action === "link") {
          await tx
            .update(accounts)
            .set({
              plaidItemId: body.itemId,
              plaidAccountId: d.plaidAccountId,
            })
            .where(eq(accounts.id, d.existingAccountId));
          linkedAccountIds.push(d.existingAccountId);
          linkedCount += 1;
          continue;
        }

        if (d.action === "link-liability") {
          await tx
            .update(liabilities)
            .set({ plaidItemId: body.itemId, plaidAccountId: d.plaidAccountId })
            .where(eq(liabilities.id, d.existingLiabilityId));
          linkedCount += 1;
          continue;
        }

        // d.action === "create"
        const liabMapped = mapPlaidToLiability(d.accountData.type, d.accountData.subtype);
        if (liabMapped) {
          // Plaid-key upsert: never duplicate a debt across re-links.
          const [existing] = await tx
            .select({ id: liabilities.id })
            .from(liabilities)
            .where(
              and(
                eq(liabilities.plaidItemId, body.itemId!),
                eq(liabilities.plaidAccountId, d.plaidAccountId),
              ),
            )
            .limit(1);
          const balanceStr = (d.accountData.balance ?? 0).toFixed(2);
          if (existing) {
            await tx
              .update(liabilities)
              .set({ balance: balanceStr, name: d.accountData.name })
              .where(eq(liabilities.id, existing.id));
          } else {
            // Held-flat revolving/debt row: term/payment null, interestRate 0,
            // NOT interest-deductible. startYear = current year (held-flat
            // ignores it). Household-owned (no liability_owners row).
            const currentYear = new Date().getFullYear();
            await tx.insert(liabilities).values({
              clientId,
              scenarioId: scenarioId!,
              name: d.accountData.name,
              liabilityType: liabMapped.liabilityType,
              balance: balanceStr,
              interestRate: "0",
              monthlyPayment: null,
              termMonths: null,
              startYear: currentYear,
              startMonth: 1,
              isInterestDeductible: false,
              plaidItemId: body.itemId,
              plaidAccountId: d.plaidAccountId,
            });
          }
          addedCount += 1;
          continue;
        }

        const mapped = mapPlaidToFoundry(d.accountData.type, d.accountData.subtype);
        if (!mapped) {
          // Unsupported Plaid type. Skip silently.
          skippedCount += 1;
          continue;
        }
        const [created] = await tx
          .insert(accounts)
          .values({
            clientId,
            scenarioId: scenarioId!,
            name: d.accountData.name,
            category: mapped.category,
            subType: mapped.subType,
            value: (d.accountData.balance ?? 0).toFixed(2),
            accountNumberLast4: d.accountData.mask ?? null,
            plaidItemId: body.itemId,
            plaidAccountId: d.plaidAccountId,
          })
          .returning({ id: accounts.id });
        linkedAccountIds.push(created.id);
        addedCount += 1;
      }
    });

    await recordCreate({
      action: "portal.plaid.link",
      resourceType: "plaid_item",
      resourceId: body.itemId,
      clientId,
      firmId: client.firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: {
        institutionName: item.institutionName,
        linkedCount,
        addedCount,
        skippedCount,
      },
    });

    return NextResponse.json({ ok: true, linkedAccountIds });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/portal/plaid/exchange/commit error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
