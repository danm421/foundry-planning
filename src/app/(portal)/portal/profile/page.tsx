import { permanentRedirect } from "next/navigation";

/**
 * Household moved into Organizer. Kept as a 308 rather than deleted: welcome
 * emails and advisor "go fill this in" nudges point at the old path.
 */
export default async function HouseholdPage(): Promise<never> {
  permanentRedirect("/portal/organizer");
}
