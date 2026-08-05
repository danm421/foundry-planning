import { permanentRedirect } from "next/navigation";

/**
 * Trusts is now a section of Organizer → Household.
 *
 * Delivered as a client-side meta refresh inside a 200, not a 308 — see the
 * sibling `profile/page.tsx` for the measurement and the reason. The `#trusts`
 * fragment survives the hop; `ScrollToHash` on the Organizer page is what makes
 * it land, because the browser resolves the fragment before that page's sections
 * have streamed in.
 */
export default async function TrustsPage(): Promise<never> {
  permanentRedirect("/portal/organizer#trusts");
}
