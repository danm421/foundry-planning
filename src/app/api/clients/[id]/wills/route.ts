import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  wills,
  willBequests,
  willBequestRecipients,
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { willCreateSchema, type WillBequestInput } from "@/lib/schemas/wills";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!row;
}

type CrossRefCheck = {
  accountIds: string[];
  familyMemberIds: string[];
  externalIds: string[];
  entityIds: string[];
};

function gatherCrossRefs(bequests: WillBequestInput[]): CrossRefCheck {
  const check: CrossRefCheck = {
    accountIds: [],
    familyMemberIds: [],
    externalIds: [],
    entityIds: [],
  };
  for (const b of bequests) {
    if (b.accountId) check.accountIds.push(b.accountId);
    for (const r of b.recipients) {
      if (!r.recipientId) continue;
      if (r.recipientKind === "family_member") check.familyMemberIds.push(r.recipientId);
      else if (r.recipientKind === "external_beneficiary") check.externalIds.push(r.recipientId);
      else if (r.recipientKind === "entity") check.entityIds.push(r.recipientId);
    }
  }
  return check;
}

async function verifyCrossRefs(
  clientId: string,
  check: CrossRefCheck,
): Promise<string | null> {
  if (check.accountIds.length > 0) {
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), inArray(accounts.id, check.accountIds)));
    if (rows.length !== new Set(check.accountIds).size) {
      return "One or more accountIds do not belong to this client";
    }
  }
  if (check.familyMemberIds.length > 0) {
    const rows = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.clientId, clientId),
          inArray(familyMembers.id, check.familyMemberIds),
        ),
      );
    if (rows.length !== new Set(check.familyMemberIds).size) {
      return "One or more family-member recipientIds do not belong to this client";
    }
  }
  if (check.externalIds.length > 0) {
    const rows = await db
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, check.externalIds),
        ),
      );
    if (rows.length !== new Set(check.externalIds).size) {
      return "One or more external-beneficiary recipientIds do not belong to this client";
    }
  }
  if (check.entityIds.length > 0) {
    const rows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.clientId, clientId), inArray(entities.id, check.entityIds)));
    if (rows.length !== new Set(check.entityIds).size) {
      return "One or more entity recipientIds do not belong to this client";
    }
  }
  return null;
}

/** Per-account soft-warning: specific bequests over-allocating one account at one condition. */
export function computeSoftWarnings(bequests: WillBequestInput[]): string[] {
  const byKey = new Map<string, number>();
  for (const b of bequests) {
    if (b.assetMode !== "specific" || !b.accountId) continue;
    const key = `${b.accountId}|${b.condition}`;
    byKey.set(key, (byKey.get(key) ?? 0) + b.percentage);
  }
  const out: string[] = [];
  for (const [key, sum] of byKey.entries()) {
    if (sum > 100.01) {
      const [accountId, condition] = key.split("|");
      out.push(
        `Account ${accountId} is over-allocated at condition '${condition}' (${sum.toFixed(2)}%)`,
      );
    }
  }
  return out;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const willRows = await db
      .select()
      .from(wills)
      .where(eq(wills.clientId, id))
      .orderBy(asc(wills.grantor));
    if (willRows.length === 0) return NextResponse.json([]);

    const willIds = willRows.map((w) => w.id);
    const bequestRows = await db
      .select()
      .from(willBequests)
      .where(inArray(willBequests.willId, willIds))
      .orderBy(asc(willBequests.willId), asc(willBequests.sortOrder));
    const bequestIds = bequestRows.map((b) => b.id);
    const recipientRows = bequestIds.length
      ? await db
          .select()
          .from(willBequestRecipients)
          .where(inArray(willBequestRecipients.bequestId, bequestIds))
          .orderBy(
            asc(willBequestRecipients.bequestId),
            asc(willBequestRecipients.sortOrder),
          )
      : [];

    const recipientsByBequest = new Map<string, typeof recipientRows>();
    for (const r of recipientRows) {
      const list = recipientsByBequest.get(r.bequestId) ?? [];
      list.push(r);
      recipientsByBequest.set(r.bequestId, list);
    }
    const bequestsByWill = new Map<string, unknown[]>();
    for (const b of bequestRows) {
      const list = bequestsByWill.get(b.willId) ?? [];
      list.push({
        id: b.id,
        name: b.name,
        assetMode: b.assetMode,
        accountId: b.accountId,
        percentage: parseFloat(b.percentage),
        condition: b.condition,
        sortOrder: b.sortOrder,
        recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
          id: r.id,
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          percentage: parseFloat(r.percentage),
          sortOrder: r.sortOrder,
        })),
      });
      bequestsByWill.set(b.willId, list);
    }
    return NextResponse.json(
      willRows.map((w) => ({
        id: w.id,
        grantor: w.grantor,
        bequests: bequestsByWill.get(w.id) ?? [],
      })),
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/wills error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = willCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Duplicate (client_id, grantor) check
    const [existing] = await db
      .select({ id: wills.id })
      .from(wills)
      .where(and(eq(wills.clientId, id), eq(wills.grantor, data.grantor)));
    if (existing) {
      return NextResponse.json(
        { error: `A will already exists for grantor='${data.grantor}'` },
        { status: 409 },
      );
    }

    const crossRefError = await verifyCrossRefs(id, gatherCrossRefs(data.bequests));
    if (crossRefError) {
      return NextResponse.json({ error: crossRefError }, { status: 400 });
    }

    const willId = await db.transaction(async (tx) => {
      const [willRow] = await tx
        .insert(wills)
        .values({ clientId: id, grantor: data.grantor })
        .returning();
      for (const b of data.bequests) {
        const [bequestRow] = await tx
          .insert(willBequests)
          .values({
            willId: willRow.id,
            name: b.name,
            assetMode: b.assetMode,
            accountId: b.accountId ?? null,
            percentage: String(b.percentage),
            condition: b.condition,
            sortOrder: b.sortOrder,
          })
          .returning();
        if (b.recipients.length > 0) {
          await tx.insert(willBequestRecipients).values(
            b.recipients.map((r) => ({
              bequestId: bequestRow.id,
              recipientKind: r.recipientKind,
              recipientId: r.recipientId,
              percentage: String(r.percentage),
              sortOrder: r.sortOrder,
            })),
          );
        }
      }
      return willRow.id;
    });

    return NextResponse.json(
      { id: willId, warnings: computeSoftWarnings(data.bequests) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/wills error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
