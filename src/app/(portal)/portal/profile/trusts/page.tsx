import { permanentRedirect } from "next/navigation";

/** Trusts is now a section of Organizer → Household. */
export default async function TrustsPage(): Promise<never> {
  permanentRedirect("/portal/organizer#trusts");
}
