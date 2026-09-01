import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { readPendingSignup } from "@/lib/billing/pending-signup";
import { normalizePlan } from "@/lib/billing/checkout";
import { LANDING_PATH } from "@/lib/routes";
import { SetupForm } from "./setup-form";

export const metadata = {
  title: "Set up your firm — Foundry Planning",
  robots: { index: false, follow: false },
};

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const [{ userId, orgId }, { plan }] = await Promise.all([auth(), searchParams]);
  // Carry the chosen plan through the bounce: a monthly buyer sent to a
  // plan-less /sign-up comes back defaulted to annual and pays the wrong price.
  if (!userId) redirect(plan ? `/sign-up?plan=${normalizePlan(plan)}` : "/sign-up");
  // Someone who already has a firm has finished this flow. Never show it twice.
  if (orgId) redirect(LANDING_PATH);

  const [saved, user] = await Promise.all([readPendingSignup(userId), currentUser()]);

  // Resumability: someone who abandoned at the card and signed back in gets
  // their profile, their logo, and their colour exactly as they left them.
  const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

  return (
    <SetupForm
      initial={{
        firmName: saved?.firmName ?? "",
        advisorName: saved?.advisorName || clerkName,
        primaryColor: saved?.primaryColor ?? null,
        logoUrl: saved?.logoUrl ?? null,
      }}
      // An explicit `?plan=` is a deliberate, current act and outranks the
      // stash: a buyer who started annual, balked at the price on Stripe and
      // came back through a MONTHLY storefront link must be charged monthly —
      // nothing on this page names the plan, so they would never see it. The
      // stash stays the fallback when the URL says nothing, which is how a
      // resume (and /select-organization's bare /welcome link) keeps working.
      plan={plan === undefined ? normalizePlan(saved?.plan) : normalizePlan(plan)}
    />
  );
}
