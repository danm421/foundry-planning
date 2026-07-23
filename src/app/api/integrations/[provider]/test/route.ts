// src/app/api/integrations/[provider]/test/route.ts
//
// Pre-save "Test connection" button: validates BYOK credentials against the
// live Addepar API and reports ok/error. Stores nothing — no connections
// table write, no audit entry. The connect route re-validates independently
// before persisting.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { testAddeparConnection } from "@/lib/integrations/providers/addepar/client";
import { encodeAddeparSecret } from "@/lib/integrations/providers/addepar/credentials";
import { resolveProvider } from "../_provider";

const body = z.object({
  apiBase: z.string().url(),
  addeparFirmId: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider || provider.authKind !== "byok") {
      return new Response("Not found", { status: 404 });
    }

    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }

    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { apiBase, addeparFirmId, apiKey, apiSecret } = parsed.data;

    await testAddeparConnection({
      providerId: provider.id,
      firmId,
      baseUrl: apiBase,
      config: { apiBase, addeparFirmId },
      getToken: async () => encodeAddeparSecret({ apiKey, apiSecret }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    return NextResponse.json({ ok: false, error: "Could not reach Addepar." }, { status: 400 });
  }
}
