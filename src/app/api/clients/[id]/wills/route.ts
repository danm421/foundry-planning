import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  wills,
  willBequests,
  willBequestRecipients,
  willResiduaryRecipients,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { willCreateSchema } from "@/lib/schemas/wills";
import {
  gatherCrossRefs,
  verifyCrossRefs,
  computeSoftWarnings,
} from "./_helpers";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
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
    const residuaryRows = await db
      .select()
      .from(willResiduaryRecipients)
      .where(inArray(willResiduaryRecipients.willId, willIds))
      .orderBy(
        asc(willResiduaryRecipients.willId),
        asc(willResiduaryRecipients.sortOrder),
      );

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
        kind: b.kind,
        name: b.name,
        assetMode: b.assetMode,
        accountId: b.accountId,
        entityId: b.entityId,
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
      });
      bequestsByWill.set(b.willId, list);
    }
    const residuaryByWill = new Map<string, typeof residuaryRows>();
    for (const r of residuaryRows) {
      const list = residuaryByWill.get(r.willId) ?? [];
      list.push(r);
      residuaryByWill.set(r.willId, list);
    }
    return NextResponse.json(
      willRows.map((w) => ({
        id: w.id,
        grantor: w.grantor,
        bequests: bequestsByWill.get(w.id) ?? [],
        residuaryRecipients: (residuaryByWill.get(w.id) ?? []).map((r) => ({
          id: r.id,
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          tier: r.tier,
          percentage: parseFloat(r.percentage),
          sortOrder: r.sortOrder,
        })),
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
    const firmId = await requireOrgId();
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = willCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
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

    const crossRefError = await verifyCrossRefs(
      id,
      gatherCrossRefs(data.bequests, data.residuaryRecipients),
      data.bequests,
    );
    if (crossRefError) {
      return NextResponse.json(
        { error: crossRefError.code, detail: crossRefError.detail },
        { status: 400 },
      );
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
            kind: b.kind,
            assetMode: b.kind === "asset" ? b.assetMode : null,
            accountId: b.kind === "asset" ? (b.accountId ?? null) : null,
            entityId: b.kind === "asset" ? (b.entityId ?? null) : null,
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
      if (data.residuaryRecipients && data.residuaryRecipients.length > 0) {
        await tx.insert(willResiduaryRecipients).values(
          data.residuaryRecipients.map((r) => ({
            willId: willRow.id,
            recipientKind: r.recipientKind,
            recipientId: r.recipientId,
            tier: r.tier,
            percentage: String(r.percentage),
            sortOrder: r.sortOrder,
          })),
        );
      }
      return willRow.id;
    });

    await recordAudit({
      action: "will.create",
      resourceType: "will",
      resourceId: willId,
      clientId: id,
      firmId,
      metadata: { grantor: data.grantor, bequestCount: data.bequests.length },
    });

    return NextResponse.json(
      { id: willId, warnings: computeSoftWarnings(data.bequests) },
      { status: 201 },
    );
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
    console.error("POST /api/clients/[id]/wills error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
