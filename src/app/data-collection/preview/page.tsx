import type { Metadata } from "next";
import { IntakePreview } from "@/components/intake/intake-preview";

// Advisor-only preview of the client intake form. This route lives OUTSIDE the
// (app) route group so it renders full-screen — no advisor sidebar/topbar —
// matching what the client actually sees. It is not a public route, so
// `src/proxy.ts` requires a Clerk session (only `/intake/(.*)` et al. are public).
export const metadata: Metadata = {
  title: "Intake form preview",
  robots: { index: false, follow: false },
};

export default function DataCollectionPreviewPage() {
  return <IntakePreview />;
}
