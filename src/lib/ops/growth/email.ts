// src/lib/ops/growth/email.ts
//
// Resend transport for the ops digest. Mirrors src/lib/notifications/email.ts:
// a missing key logs rather than throws, and delivery is REPORTED so the route
// can say honestly whether anything was sent.
import { Resend } from "resend";

const DEFAULT_FROM = "Foundry Ops <alerts@foundryplanning.com>";
const DEFAULT_TO = "dan@foundryplanning.com";

export async function sendOpsDigest(args: {
  subject: string;
  text: string;
}): Promise<{ delivered: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.OPS_DIGEST_TO || DEFAULT_TO;
  const from = process.env.OPS_DIGEST_FROM || DEFAULT_FROM;

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log("[ops-digest] Resend not configured — skipping\n", args.text);
    } else {
      console.error("[ops-digest] RESEND_API_KEY is not set — the digest cannot send");
    }
    return { delivered: false };
  }

  try {
    const resend = new Resend(apiKey);
    // resend.emails.send() resolves { data: null, error } for every non-2xx
    // response rather than throwing — the `error` check is the real net.
    const { error } = await resend.emails.send({ from, to, subject: args.subject, text: args.text });
    if (error) {
      console.error("[ops-digest] Resend rejected the send:", error.message ?? error);
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[ops-digest] Resend send failed:", err instanceof Error ? err.message : err);
    return { delivered: false };
  }
}
