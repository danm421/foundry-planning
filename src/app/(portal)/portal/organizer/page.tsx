import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import OrganizerHouseholdScreen from "@/components/portal/organizer-household-screen";
import ScrollToHash from "@/components/portal/scroll-to-hash";

/**
 * Organizer → Household. The markup lives in `OrganizerHouseholdScreen`, shared
 * with the advisor preview so the two surfaces cannot drift.
 *
 * `ScrollToHash` is what makes the `#family` / `#trusts` anchors land. This page
 * is async and sits under the portal's `loading.tsx`, so the browser resolves
 * the fragment against the skeleton — before any of those sections exist — and
 * never retries. See that component for the measurement. It is passed as the
 * screen's child so it mounts inside the streamed subtree, in the same commit as
 * the sections it scrolls to.
 */
export default async function OrganizerHouseholdPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return (
    <OrganizerHouseholdScreen clientId={clientId}>
      <ScrollToHash />
    </OrganizerHouseholdScreen>
  );
}
