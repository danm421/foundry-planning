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
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-up");
  // Someone who already has a firm has finished this flow. Never show it twice.
  if (orgId) redirect(LANDING_PATH);

  const [{ plan }, saved, user] = await Promise.all([
    searchParams,
    readPendingSignup(userId),
    currentUser(),
  ]);

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
      plan={normalizePlan(saved?.plan ?? plan)}
    />
  );
}
