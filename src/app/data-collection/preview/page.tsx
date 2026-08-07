import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { resolveIntakeBranding } from "@/lib/branding/branding";
import { IntakePreview } from "@/components/intake/intake-preview";
import { loadAdvisorDefaultSections } from "@/lib/intake/queries";
import { sectionsForForm } from "@/lib/intake/sections";

// Advisor-only preview of the client intake form. This route lives OUTSIDE the
// (app) route group so it renders full-screen — no advisor sidebar/topbar —
// matching what the client actually sees. It is not a public route, so
// `src/proxy.ts` requires a Clerk session (only `/intake/(.*)` et al. are public).
export const metadata: Metadata = {
  title: "Intake form preview",
  robots: { index: false, follow: false },
};

export default async function DataCollectionPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ steps?: string }>;
}) {
  // Resolve the advisor's own firm branding so the preview honors its
  // "exactly what your client sees" promise — letterhead included.
  const { orgId, userId } = await auth();
  const branding = orgId ? await resolveIntakeBranding(orgId) : null;

  // `?steps=` is what the send card's Preview link carries, so an advisor sees
  // exactly the set they're about to send rather than the saved default. It
  // runs through sectionsForForm, so a hand-edited or stale URL degrades to a
  // sane form rather than an error page.
  const { steps } = await searchParams;
  const saved = orgId && userId ? await loadAdvisorDefaultSections(orgId, userId) : null;
  const sections = steps ? sectionsForForm(steps.split(",")) : sectionsForForm(saved);

  return <IntakePreview branding={branding} sections={sections} />;
}
