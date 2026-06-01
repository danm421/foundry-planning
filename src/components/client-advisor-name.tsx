import { clerkClient } from "@clerk/nextjs/server";

/**
 * Resolves and renders the lead advisor's display name for the client header.
 *
 * Pulled out of the client layout and rendered under its own `<Suspense>` so
 * the Clerk `getUser` round-trip — an external API call, the slowest dependency
 * in the layout — no longer blocks the page shell. The header (and the tab bar
 * above it) commit immediately; the name fills in when this resolves.
 */
export async function ClientAdvisorName({ advisorId }: { advisorId: string }) {
  try {
    const cc = await clerkClient();
    const advisor = await cc.users.getUser(advisorId);
    const name =
      [advisor.firstName, advisor.lastName].filter(Boolean).join(" ").trim() ||
      advisor.emailAddresses?.[0]?.emailAddress ||
      "Advisor";
    return <>{name}</>;
  } catch {
    // advisor user deleted / not found — fall back to a neutral label
    return <>Advisor</>;
  }
}
