// src/app/api/forge/fact-finder/identify/route.ts
//
// Clientless identity "peek" for the global-Forge attach-first ingest flow.
// Mirrors the global stream route's gate chain (NO client access gate — there is
// no client yet) and the files route's upload validation, but persists NOTHING:
// it reads the document in-memory, returns the household identity, and lists
// firm-scoped duplicate candidates so the panel/agent can branch.
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, authErrorResponse } from "@/lib/authz";
import { checkForgeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { isForgeEnabled, hasForgeEntitlement } from "@/domain/forge/flag";
import { detectUploadKind } from "@/lib/extraction/validate-upload";
import { identifyHousehold } from "@/lib/extraction/identify-household";
import { listCrmHouseholds } from "@/lib/crm/households";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB — mirrors the files route.

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request): Promise<Response> {
  // --- Gate chain (canonical order, mirrors src/app/api/forge/stream/route.ts) ---

  // 1. Feature flag.
  if (!isForgeEnabled()) return new Response("Not found", { status: 404 });

  // 2-4. Tenant → active subscription → auth + entitlement.
  // NO client access gate — this is the clientless (global) route.
  let firmId: string;
  let entitlements: string[] | undefined;
  try {
    firmId = await requireOrgId();
    await requireActiveSubscription();
    const { userId, sessionClaims } = await auth();
    if (!userId) return json(401, { error: "Unauthorized" });
    await currentUser();
    const claims = sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null;
    entitlements = claims?.org_public_metadata?.entitlements;
  } catch (err) {
    const mapped = authErrorResponse(err);
    if (mapped) return json(mapped.status, mapped.body);
    throw err;
  }
  if (!hasForgeEntitlement(entitlements)) {
    return json(403, { error: "Forge is not enabled for your plan." });
  }

  // 5. Rate limit (fail-closed) — reuse the Forge-family limiter (clientless).
  const rl = await checkForgeRateLimit(firmId);
  if (!rl.allowed) {
    return rateLimitErrorResponse(rl, "Too many Forge requests. Please wait a moment and try again.");
  }

  // --- Past the gates: read + validate the file (no persistence) ---

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 65536) {
    return json(413, { error: "File too large. Maximum size is 20MB." });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "No file provided" });
  if (file.size > MAX_FILE_SIZE) return json(413, { error: "File too large. Maximum size is 20MB." });

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = detectUploadKind(buffer);
  if (!kind) {
    return json(400, { error: "Unsupported file type. Upload a PDF, Word, Excel, CSV, or image (PNG/JPEG) file." });
  }

  // Cheap identity peek — Task 1's mini-model call, no persistence.
  let result;
  try {
    result = await identifyHousehold(buffer, file.name, kind);
  } catch (err) {
    console.error(
      "POST /api/forge/fact-finder/identify failed:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown error",
    );
    return json(500, { error: "Could not read this document. Please try again." });
  }

  if (!result.isHouseholdDoc || !result.identity) {
    return json(200, { isHouseholdDoc: false, duplicateCandidates: [] });
  }

  // Firm-scoped duplicate candidates by household/last name. A blank or
  // whitespace-only name would drop listCrmHouseholds' name filter (empty
  // search → unfiltered) and surface arbitrary same-firm households as false
  // "duplicates", feeding unrelated clientIds into a write-capable ingest turn.
  // No usable name → no candidates.
  const searchName = result.identity.householdName.trim();
  const rows = searchName ? await listCrmHouseholds({ search: searchName, limit: 10 }) : [];
  const duplicateCandidates = rows.map((h) => ({
    householdId: h.id,
    clientId: h.planningClient?.id ?? null,
    name: h.name,
    status: h.status,
  }));

  return json(200, { isHouseholdDoc: true, identity: result.identity, duplicateCandidates });
}
