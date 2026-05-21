import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { commit, type ImportDecision } from "@/lib/crm/import";
import {
  createCrmHouseholdSchema,
  createCrmContactSchema,
} from "@/lib/crm/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Re-validate every row before it hits the DB. The wizard sends back
// whatever was in the preview, but a malicious client could swap in
// arbitrary payloads — the lib trusts its inputs are valid.
const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    row: z.object({
      household: createCrmHouseholdSchema,
      primary: createCrmContactSchema,
      spouse: createCrmContactSchema.optional(),
    }),
  }),
  z.object({
    action: z.literal("skip"),
    row: z.object({
      household: createCrmHouseholdSchema,
      primary: createCrmContactSchema,
      spouse: createCrmContactSchema.optional(),
    }),
    matchedHouseholdId: z.uuid(),
  }),
]);

const bodySchema = z.object({
  decisions: z.array(decisionSchema).min(1).max(1000),
});

export async function POST(req: NextRequest) {
  try {
    const firmId = await requireOrgId();

    const rl = await checkImportRateLimit(firmId, "commit");
    if (!rl.allowed) {
      let status: number;
      let message: string;
      switch (rl.reason) {
        case "unconfigured":
          status = 503;
          message = "Rate limiting is not configured — bulk import is disabled.";
          break;
        case "redis_error":
          status = 503;
          message =
            "Rate limiting is temporarily unavailable. Please retry in a moment.";
          break;
        case "exceeded":
          status = 429;
          message = "Too many import commits. Please wait and try again.";
          break;
      }
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(
          Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
        );
      }
      return NextResponse.json({ error: message }, { status, headers });
    }

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await commit(parsed.data.decisions as ImportDecision[]);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error("POST /api/crm/import/commit failed:", safeMessage);
    return NextResponse.json(
      { error: "Import commit failed. Please try again." },
      { status: 500 },
    );
  }
}
