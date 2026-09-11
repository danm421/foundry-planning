import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requirePortalSession } from "@/lib/portal/require-portal-session";
import { resolveHouseholdNames } from "@/lib/portal/household-names";
import { resolvePortalFirmNames, UNNAMED_FIRM } from "@/lib/portal/firm-names";
import {
  listPendingRequests,
  acceptBinding,
  declineBinding,
  type PendingRequest,
} from "@/lib/portal/bindings";

export const dynamic = "force-dynamic";

/**
 * Same dedupe for the advisor who asked. A Clerk failure — one user, or the
 * client itself — degrades that name to null rather than 500ing the list: the
 * client can still see which firm is asking and decide.
 */
async function resolveAdvisorNames(pending: PendingRequest[]): Promise<Map<string, string>> {
  const ids = [...new Set(pending.map((p) => p.requestedBy).filter((id) => id !== null))];
  if (ids.length === 0) return new Map();
  try {
    const cc = await clerkClient();
    const entries = await Promise.all(
      ids.map(async (id): Promise<[string, string] | null> => {
        try {
          const u = await cc.users.getUser(id);
          const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
          return name ? [id, name] : null;
        } catch {
          return null;
        }
      }),
    );
    return new Map(entries.filter((e) => e !== null));
  } catch (err) {
    console.warn("[portal-requests] Clerk unavailable; advisor names omitted", err);
    return new Map();
  }
}

/**
 * Pending access requests awaiting this person's decision.
 *
 * Serves someone being asked for their FIRST binding, so it is one of the three
 * handlers gated by `requirePortalSession` rather than
 * `requireClientPortalAccess`; that module's doc comment carries the reasoning,
 * and `proxy.ts` enumerates all three.
 */
export async function GET(): Promise<Response> {
  const gate = await requirePortalSession();
  if (gate instanceof Response) return gate;

  const pending = await listPendingRequests(gate.userId);
  if (pending.length === 0) return NextResponse.json({ requests: [] });

  // Three independent lookups — none feeds another.
  const [householdNames, firmNames, advisorNames] = await Promise.all([
    resolveHouseholdNames(pending.map((p) => p.clientId)),
    resolvePortalFirmNames(pending.map((p) => p.firmId)),
    resolveAdvisorNames(pending),
  ]);

  return NextResponse.json({
    requests: pending.map((p) => ({
      bindingId: p.bindingId,
      // A household with no primary contact has no derivable name. Say
      // "your household" rather than showing a blank where a name belongs.
      householdName: householdNames.get(p.clientId) ?? "your household",
      firmName: firmNames.get(p.firmId) ?? UNNAMED_FIRM,
      advisorName: p.requestedBy ? advisorNames.get(p.requestedBy) ?? null : null,
      expiresAt: p.expiresAt,
    })),
  });
}

export async function POST(req: Request): Promise<Response> {
  const gate = await requirePortalSession();
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => ({}))) as {
    bindingId?: unknown;
    action?: unknown;
  };
  if (typeof body.bindingId !== "string") {
    return NextResponse.json({ error: "bindingId required" }, { status: 400 });
  }

  // Both mutators take the caller's own userId — NEVER one supplied in the
  // body — and re-check it inside their own UPDATE's WHERE clause.
  if (body.action === "decline") {
    const ok = await declineBinding(body.bindingId, gate.userId);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (body.action !== "accept") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const result = await acceptBinding(body.bindingId, gate.userId);
  if (result.ok) return NextResponse.json({ ok: true, clientId: result.clientId });

  if (result.reason === "not_found") {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      error:
        result.reason === "expired"
          ? "This request has expired. Ask your advisor to send a new one."
          : "This request is no longer pending.",
    },
    { status: 409 },
  );
}
