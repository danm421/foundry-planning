import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import HouseholdSection from "@/components/portal/household-section";
import FamilySection from "@/components/portal/family-section";
import TrustsSection from "@/components/portal/trusts-section";
import ScrollToHash from "@/components/portal/scroll-to-hash";

/**
 * Organizer → Household. Three former rail destinations on one page.
 *
 * The `id` anchors are load-bearing, not decorative: `/portal/profile/family`
 * and `/portal/profile/trusts` permanently redirect to `#family` / `#trusts`
 * here (Task 5), so an old welcome-email link lands on the section that route
 * used to own rather than at the top of the page.
 *
 * `ScrollToHash` is what makes them land. This page is async and sits under the
 * portal's `loading.tsx`, so the browser resolves the fragment against the
 * skeleton — before any of these sections exist — and never retries. See that
 * component for the measurement.
 */
export default async function OrganizerHouseholdPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return (
    <div className="flex flex-col">
      <section id="household">
        <HouseholdSection clientId={clientId} />
      </section>
      <section id="family" className="scroll-mt-4 border-t border-hair">
        <FamilySection clientId={clientId} />
      </section>
      <section id="trusts" className="scroll-mt-4 border-t border-hair">
        <TrustsSection clientId={clientId} />
      </section>
      <ScrollToHash />
    </div>
  );
}
