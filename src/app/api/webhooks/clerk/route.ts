import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { handleClerkEvent, type ClerkEvent } from "./handler";

export const dynamic = "force-dynamic";

// POST /api/webhooks/clerk — receives Clerk webhook deliveries.
// Verifies the Svix signature, parses the event, and dispatches to
// handleClerkEvent. This route MUST be excluded from Clerk auth in
// middleware.ts so inbound deliveries aren't redirected to /sign-in.
export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[webhook.clerk] CLERK_WEBHOOK_SECRET not set — refusing request"
    );
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing Svix headers" },
      { status: 400 }
    );
  }

  // Svix needs the raw body to verify the signature — never parse as JSON first.
  const body = await req.text();

  let evt: ClerkEvent;
  try {
    evt = new Webhook(secret).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkEvent;
  } catch (err) {
    console.error(
      "[webhook.clerk] signature verification failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  return handleClerkEvent(evt);
}
