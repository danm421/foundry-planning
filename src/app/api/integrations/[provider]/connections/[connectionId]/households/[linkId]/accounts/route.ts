import { NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORY_OPTIONS, SUB_TYPE_OPTIONS } from "@/lib/accounts/category-labels";
import { recordAudit, type AuditAction } from "@/lib/audit";
import { ForbiddenError, authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import {
  AccountPanelRefusal,
  addHouseholdAccount,
  connectHouseholdAccount,
  disconnectPlanAccount,
  findLinkOnConnection,
  loadHouseholdAccounts,
} from "@/lib/integrations/household-accounts";
import { resolveOwnedConnection } from "../../../_owned";

type Params = { params: Promise<{ provider: string; connectionId: string; linkId: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** The panel's three actions. Types and sub-types are the ones the panel offers. */
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), externalId: z.string().min(1), planAccountId: z.uuid() }),
  z.object({
    action: z.literal("add"),
    externalId: z.string().min(1),
    category: z.enum(CATEGORY_OPTIONS.map((o) => o.value)),
    subType: z.enum(SUB_TYPE_OPTIONS.map((o) => o.value)),
    owner: z.enum(["client", "spouse", "joint"]),
  }),
  z.object({ action: z.literal("disconnect"), planAccountId: z.uuid() }),
]);

/**
 * The caller's own connection, a link on it, and the link's client, which the
 * caller must still hold as their own: the panel reads and writes that
 * client's plan accounts. Null for any miss, so the route answers 404 alike
 * and neither a connection id nor a link id can be probed.
 */
async function resolveOwnedLink(params: Params["params"]) {
  const owned = await resolveOwnedConnection(params);
  if (!owned) return null;
  const { linkId } = await params;
  const link = await findLinkOnConnection({ connectionId: owned.connection.id, linkId });
  if (!link) return null;
  // The same gate the link POST uses. A cross-firm edit share grants plan
  // editing, not the right to feed the plan from this firm's provider.
  const access = await requireClientEditAccess(link.clientId).catch((err: unknown) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (access?.access !== "own") return null;
  return { ...owned, link };
}

/** GET — the account panel for one linked household, from its last pull. */
export async function GET(_req: Request, { params }: Params): Promise<Response> {
  try {
    const held = await resolveOwnedLink(params);
    if (!held) return notFound();
    const panel = await loadHouseholdAccounts({
      connectionId: held.connection.id,
      linkId: held.link.id,
      providerId: held.provider.id,
    });
    return panel ? NextResponse.json(panel) : notFound();
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("GET /api/integrations/[provider]/connections/[connectionId]/households/[linkId]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST — connect, add or disconnect one account, then return the fresh panel. */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  try {
    const held = await resolveOwnedLink(params);
    if (!held) return notFound();
    const { provider, connection, link, firmId, userId } = held;

    const parsed = actionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    await requireActiveSubscriptionForFirm(firmId);

    const ids = { connectionId: connection.id, linkId: link.id, providerId: provider.id };
    const body = parsed.data;
    let done: { action: AuditAction; planAccountId: string; externalId: string | null };
    if (body.action === "connect") {
      await connectHouseholdAccount({ ...ids, externalId: body.externalId, planAccountId: body.planAccountId, userId });
      done = { action: "integration.account.connect", planAccountId: body.planAccountId, externalId: body.externalId };
    } else if (body.action === "add") {
      const planAccountId = await addHouseholdAccount({
        ...ids,
        externalId: body.externalId,
        category: body.category,
        subType: body.subType,
        owner: body.owner,
        userId,
      });
      done = { action: "integration.account.add", planAccountId, externalId: body.externalId };
    } else {
      const externalId = await disconnectPlanAccount({ ...ids, planAccountId: body.planAccountId, userId });
      done = { action: "integration.account.disconnect", planAccountId: body.planAccountId, externalId };
    }

    await recordAudit({
      action: done.action,
      resourceType: "account",
      resourceId: done.planAccountId,
      clientId: link.clientId,
      firmId,
      metadata: {
        provider: provider.id,
        connectionId: connection.id,
        linkId: link.id,
        externalId: done.externalId,
        planAccountId: done.planAccountId,
      },
    });

    const panel = await loadHouseholdAccounts(ids);
    return panel ? NextResponse.json(panel) : notFound();
  } catch (err) {
    if (err instanceof AccountPanelRefusal) return NextResponse.json({ error: err.message }, { status: 409 });
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/connections/[connectionId]/households/[linkId]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
