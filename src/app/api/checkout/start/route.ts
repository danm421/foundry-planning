import { NextResponse } from "next/server";
import { normalizePlan } from "@/lib/billing/checkout";

/**
 * Kept as a doorway, not a checkout. The storefront may still deep-link this
 * path, and it shipped four hours before this change — so it stays reachable and
 * forwards to where signup now begins.
 *
 * Card-first checkout is gone from the app: a buyer who paid before we knew who
 * they were had to be reached by invitation email, which is the drop-off this
 * whole change removes. The sales path in docs/founding-pricing-runbook.md is
 * unaffected — it builds its Checkout sessions in the Stripe CLI and never
 * called this route.
 */
export const dynamic = "force-dynamic";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

export async function GET(req: Request): Promise<Response> {
  const plan = normalizePlan(new URL(req.url).searchParams.get("plan"));
  return NextResponse.redirect(new URL(`/sign-up?plan=${plan}`, appUrl()), {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
}
