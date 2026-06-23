import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactionCategories, clients } from "@/db/schema";
import { authErrorResponse, requireClientPortalAccess } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordCreate } from "@/lib/audit/record-helpers";
import { ensureCategoriesSeeded } from "@/lib/portal/seed-categories";

export const dynamic = "force-dynamic";

type Body = { name?: string; kind?: string; parentId?: string | null; color?: string };

export async function GET(): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await ensureCategoriesSeeded(clientId);
    const categories = await db
      .select().from(transactionCategories)
      .where(eq(transactionCategories.clientId, clientId))
      .orderBy(transactionCategories.sortOrder);
    return NextResponse.json({ categories });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.name || !body.name.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (body.kind !== "group" && body.kind !== "category") return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    let parentId: string | null = null;
    if (body.kind === "category") {
      if (!body.parentId) return NextResponse.json({ error: "parentId required for a category" }, { status: 400 });
      const [parent] = await db
        .select({ clientId: transactionCategories.clientId, kind: transactionCategories.kind })
        .from(transactionCategories).where(eq(transactionCategories.id, body.parentId)).limit(1);
      if (!parent || parent.clientId !== clientId || parent.kind !== "group") {
        return NextResponse.json({ error: "invalid parent" }, { status: 400 });
      }
      parentId = body.parentId;
    }
    const [{ firmId } = { firmId: null as string | null }] = await db
      .select({ firmId: clients.firmId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [row] = await db
      .insert(transactionCategories)
      .values({
        clientId, parentId, name: body.name.trim(), slug: null,
        color: body.color ?? "var(--data-grey)", kind: body.kind, isSystem: false, sortOrder: 999,
      })
      .returning({ id: transactionCategories.id });

    await recordCreate({
      action: "portal.category.create", resourceType: "transaction_category", resourceId: row.id,
      clientId, firmId, actorKind: "client",
      snapshot: { name: body.name.trim(), kind: body.kind, parentId },
    });
    return NextResponse.json({ id: row.id });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
