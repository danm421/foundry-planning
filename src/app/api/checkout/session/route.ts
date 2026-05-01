import { NextResponse } from "next/server";
import { z } from "zod";
import { getStripe } from "@/lib/billing/stripe-client";
import { buildCheckoutSessionParams } from "@/lib/billing/checkout";
import { checkCheckoutSessionRateLimit, extractClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  priceKey: z.enum(["seatMonthly", "seatAnnual"]),
});

function originFor(req: Request): string {
  const fromHeader = req.headers.get("origin");
  if (fromHeader) return fromHeader;
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

export async function POST(req: Request): Promise<Response> {
  const ip = extractClientIp(req);
  const rl = await checkCheckoutSessionRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_price_key" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        priceKey: parsed.data.priceKey,
        origin: originFor(req),
      }),
    );
    if (!session.url) {
      console.error(
        "[checkout] stripe returned session without url:",
        session.id,
      );
      return NextResponse.json(
        { error: "checkout_unavailable" },
        { status: 500 },
      );
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[checkout] stripe error:", err);
    return NextResponse.json(
      { error: "checkout_unavailable" },
      { status: 500 },
    );
  }
}

function rateLimitHeaders(
  rl: Extract<
    Awaited<ReturnType<typeof checkCheckoutSessionRateLimit>>,
    { allowed: false }
  >,
): Record<string, string> {
  if ("reset" in rl && typeof rl.reset === "number") {
    const seconds = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
    return { "Retry-After": String(seconds) };
  }
  return {};
}
