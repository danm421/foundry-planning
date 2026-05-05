import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  wills,
  willBequests,
  willBequestRecipients,
  willResiduaryRecipients,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { willUpdateSchema } from "@/lib/schemas/wills";
import {
  gatherCrossRefs,
  verifyCrossRefs,
  computeSoftWarnings,
} from "../_helpers";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!row;
}

async function verifyWillBelongsToClient(willId: string, clientId: string) {
  const [row] = await db
    .select({ id: wills.id })
    .from(wills)
    .where(and(eq(wills.id, willId), eq(wills.clientId, clientId)));
  return !!row;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, willId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const [willRow] = await db
      .select()
      .from(wills)
      .where(and(eq(wills.id, willId), eq(wills.clientId, id)));
    if (!willRow) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    const bequestRows = await db
      .select()
      .from(willBequests)
      .where(eq(willBequests.willId, willId))
      .orderBy(asc(willBequests.sortOrder));
    const bequestIds = bequestRows.map((b) => b.id);
    const recipientRows = bequestIds.length
      ? await db
          .select()
          .from(willBequestRecipients)
          .where(inArray(willBequestRecipients.bequestId, bequestIds))
          .orderBy(asc(willBequestRecipients.sortOrder))
      : [];
    const residuaryRows = await db
      .select()
      .from(willResiduaryRecipients)
      .where(eq(willResiduaryRecipients.willId, willRow.id))
      .orderBy(asc(willResiduaryRecipients.sortOrder));

    const recipientsByBequest = new Map<string, typeof recipientRows>();
    for (const r of recipientRows) {
      const list = recipientsByBequest.get(r.bequestId) ?? [];
      list.push(r);
      recipientsByBequest.set(r.bequestId, list);
    }
    return NextResponse.json({
      id: willRow.id,
      grantor: willRow.grantor,
      bequests: bequestRows.map((b) => ({
        id: b.id,
        kind: b.kind,
        name: b.name,
        assetMode: b.assetMode,
        accountId: b.accountId,
        liabilityId: b.liabilityId,
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
      })),
      residuaryRecipients: residuaryRows.map((r) => ({
        id: r.id,
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        percentage: parseFloat(r.percentage),
        sortOrder: r.sortOrder,
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, willId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!(await verifyWillBelongsToClient(willId, id))) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = willUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { bequests, residuaryRecipients } = parsed.data;

    const crossRefError = await verifyCrossRefs(
      id,
      gatherCrossRefs(bequests, residuaryRecipients),
      bequests,
    );
    if (crossRefError) {
      return NextResponse.json(
        { error: crossRefError.code, detail: crossRefError.detail },
        { status: 400 },
      );
    }

    // Transactional full-replace: delete existing bequests (cascades to
    // recipients) and residuary, then re-insert.
    await db.transaction(async (tx) => {
      await tx.delete(willBequests).where(eq(willBequests.willId, willId));
      await tx
        .delete(willResiduaryRecipients)
        .where(eq(willResiduaryRecipients.willId, willId));
      for (const b of bequests) {
        const [bequestRow] = await tx
          .insert(willBequests)
          .values({
            willId,
            name: b.name,
            kind: b.kind,
            assetMode: b.kind === "asset" ? b.assetMode : null,
            accountId: b.kind === "asset" ? (b.accountId ?? null) : null,
            liabilityId: b.kind === "liability" ? b.liabilityId : null,
            percentage: b.kind === "asset" ? String(b.percentage) : "100",
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
      if (residuaryRecipients && residuaryRecipients.length > 0) {
        await tx.insert(willResiduaryRecipients).values(
          residuaryRecipients.map((r) => ({
            willId,
            recipientKind: r.recipientKind,
            recipientId: r.recipientId,
            percentage: String(r.percentage),
            sortOrder: r.sortOrder,
          })),
        );
      }
      await tx
        .update(wills)
        .set({ updatedAt: new Date() })
        .where(eq(wills.id, willId));
    });

    return NextResponse.json({
      id: willId,
      warnings: computeSoftWarnings(bequests),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Unique-index violation: map 23505 on will_bequests_liability_idx → 400
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      const constraint = (err as { constraint?: string }).constraint ?? "";
      if (constraint.includes("will_bequests_liability_idx")) {
        return NextResponse.json(
          { error: "duplicate_liability_bequest" },
          { status: 400 },
        );
      }
    }
    console.error("PATCH /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, willId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!(await verifyWillBelongsToClient(willId, id))) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    await db.delete(wills).where(eq(wills.id, willId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
