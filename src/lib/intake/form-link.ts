import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { resolveClientPortalUserId } from "@/lib/portal/bindings";
import type { IntakeFormRow } from "./queries";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";

/**
 * Where the recipient picks an EXISTING form back up, and whose brand the mail
 * should carry. Shared by the two mails that point at a form already out —
 * Remind and Reopen — so they cannot send the client to different places.
 *
 * `link` is null for a pre-filled form whose client has no Foundry login yet:
 * that form lives behind the portal sign-in, and what's outstanding is the
 * Clerk invitation (the Access tab owns it), not a link.
 */
export async function resolveFormLink(
  form: Pick<IntakeFormRow, "clientId" | "mode" | "token">,
  firmId: string,
  senderUserId: string,
): Promise<{ link: string | null; brandAdvisorUserId: string }> {
  // A prospect form has no client behind it.
  const [client] = form.clientId
    ? await db
        .select({ advisorId: clients.advisorId, clerkUserId: clients.clerkUserId })
        .from(clients)
        .where(and(eq(clients.id, form.clientId), eq(clients.firmId, firmId)))
    : [];

  // The household's own advisor owns the brand — same rule as the first send,
  // which resolves it off `requireClientEditAccess`; falls back to the sender.
  const brandAdvisorUserId = client?.advisorId ?? senderUserId;

  // A blank form travels on its own token; a prefilled one lives behind the
  // portal login, so the mail points at the portal rather than minting a
  // second way in.
  if (form.mode !== "prefilled") {
    return { link: `${APP_URL}/intake/${form.token}`, brandAdvisorUserId };
  }
  const boundClerkUserId = form.clientId
    ? await resolveClientPortalUserId(form.clientId, client?.clerkUserId ?? null)
    : null;
  return {
    link: boundClerkUserId ? `${APP_URL}/portal/intake` : null,
    brandAdvisorUserId,
  };
}
