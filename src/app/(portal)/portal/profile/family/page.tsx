import { permanentRedirect } from "next/navigation";

/** Family is now a section of Organizer → Household. */
export default async function FamilyPage(): Promise<never> {
  permanentRedirect("/portal/organizer#family");
}
