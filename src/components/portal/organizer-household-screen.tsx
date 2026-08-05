import type { ReactElement, ReactNode } from "react";
import HouseholdSection from "@/components/portal/household-section";
import FamilySection from "@/components/portal/family-section";
import TrustsSection from "@/components/portal/trusts-section";

/**
 * Organizer → Household. Three former rail destinations stacked on one page.
 *
 * Shared by BOTH surfaces that render this tab — the client portal
 * (`(portal)/portal/organizer/page.tsx`) and the advisor preview
 * (`(preview)/clients/[id]/portal/preview/[[...slug]]/page.tsx`) — the same way
 * Goals, Cash Flow and Accounts already are. The brief asked the two surfaces to
 * mirror each other; owning the markup once makes that a fact rather than a
 * convention, which matters because the two inline copies this replaced had
 * already drifted (only the portal one rendered `ScrollToHash`).
 *
 * The `id` anchors are load-bearing, not decorative: `/portal/profile/family`
 * and `/portal/profile/trusts` permanently redirect to `#family` / `#trusts`,
 * so an old welcome-email link lands on the section that route used to own
 * rather than at the top of the page.
 *
 * `children` is the anchor-scroll slot. It renders INSIDE this flex column, so
 * anything placed there is inserted in the same commit as the sections — which
 * is exactly the ordering `ScrollToHash` depends on. The portal passes it; the
 * preview deliberately does not (no route redirects into the preview by
 * fragment, so there is no hash for it to re-apply).
 */
export default function OrganizerHouseholdScreen({
  clientId,
  children,
}: {
  clientId: string;
  children?: ReactNode;
}): ReactElement {
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
      {children}
    </div>
  );
}
