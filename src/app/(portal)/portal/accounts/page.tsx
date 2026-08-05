import { permanentRedirect } from "next/navigation";

/**
 * Accounts is now an Organizer tab.
 *
 * Delivered as a client-side meta refresh inside a 200, not a 308 — see
 * `(portal)/portal/profile/page.tsx` for the measurement and the reason.
 */
export default async function AccountsPage(): Promise<never> {
  permanentRedirect("/portal/organizer/accounts");
}
