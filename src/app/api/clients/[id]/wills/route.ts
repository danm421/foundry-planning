import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  wills,
  willBequests,
  willBequestRecipients,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { willCreateSchema } from "@/lib/schemas/wills";
import {
  gatherCrossRefs,
  verifyCrossRefs,
  computeSoftWarnings,
} from "./_helpers";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!row;
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
