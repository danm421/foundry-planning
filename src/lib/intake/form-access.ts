import { auth } from "@clerk/nextjs/server";
import { ForbiddenError } from "@/lib/authz";
import { callerMaySeeAdvisor, requireClientEditAccess } from "@/lib/clients/authz";
import { loadFormForFirm, type IntakeFormRow } from "./queries";

/**
 * A data-collection form the signed-in advisor may act on: in their firm AND
 * in their book. A form bound to a client needs edit access to that client,
 * the gate every other planning write uses. A form with no client yet needs
 * the caller to see the book of the advisor who sent it. Missing and refused
 * both return null, so callers answer 404 and a form's existence never leaks
 * across books.
 */
export async function loadFormForCaller(id: string, orgId: string): Promise<IntakeFormRow | null> {
  const form = await loadFormForFirm(id, orgId);
  if (!form) return null;

  if (form.clientId) {
    try {
      await requireClientEditAccess(form.clientId);
      return form;
    } catch (err) {
      if (err instanceof ForbiddenError) return null;
      throw err;
    }
  }

  const { userId, orgRole } = await auth();
  if (!userId) return null;
  const visible = await callerMaySeeAdvisor(
    { userId, orgId, orgRole: orgRole ?? null },
    form.createdByUserId,
    orgId,
  );
  return visible ? form : null;
}
