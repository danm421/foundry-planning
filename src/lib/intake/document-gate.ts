import { NextResponse } from "next/server";
import {
  extractClientIp,
  checkIntakeDocumentRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { loadFormByToken, type IntakeFormRow } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import { isGateVerified } from "@/lib/intake/gate-session";

type Gated =
  | { error: NextResponse; form?: undefined }
  | { error?: undefined; form: IntakeFormRow };

/** Token → form → expiry → draft-status → identity cookie, plus rate limiting.
 *  Shared by the intake document collection and item routes. */
export async function gateIntakeDocumentRequest(token: string, req: Request): Promise<Gated> {
  const ip = extractClientIp(req);
  const rl = await checkIntakeDocumentRateLimit(`${token}:${ip}`);
  if (!rl.allowed) {
    return { error: rateLimitErrorResponse(rl, "Too many uploads. Please slow down.") };
  }

  const form = await loadFormByToken(token);
  if (!form) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  if (isExpired(form, new Date())) {
    return { error: NextResponse.json({ error: "This form link has expired." }, { status: 410 }) };
  }
  if (form.status !== "draft") {
    return {
      error: NextResponse.json(
        { error: "This form has already been submitted." },
        { status: 409 },
      ),
    };
  }
  if (!(await isGateVerified(form.id))) {
    return { error: NextResponse.json({ error: "Verification required." }, { status: 401 }) };
  }
  return { form };
}
