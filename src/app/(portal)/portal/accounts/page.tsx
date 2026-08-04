import { permanentRedirect } from "next/navigation";

/** Accounts is now an Organizer tab. */
export default async function AccountsPage(): Promise<never> {
  permanentRedirect("/portal/organizer/accounts");
}
