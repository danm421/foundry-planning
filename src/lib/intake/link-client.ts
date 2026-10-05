import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, intakeForms } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { adoptParkedUploads } from "./documents";

export type LinkIntakeResult = "linked" | "form_not_found" | "client_not_found" | "conflict";

/** Only a new-household form still awaiting review can be pointed at a client. */
export function canLinkToClient(form: { clientId: string | null; status: string }): boolean {
  return form.clientId === null && form.status === "submitted";
}

/**
 * Point a submitted new-household form at a client the advisor already has, so
 * applying it merges into that client instead of creating a duplicate household
 * — the advisor sent a blank form, then entered the client by hand before it
 * came back. One-way on purpose: once linked it is exactly the form an advisor
 * sends from a client's record, and Discard is the way out.
 */
export async function linkIntakeFormToClient(args: {
  formId: string;
  firmId: string;
  clientId: string;
  actorId: string;
}): Promise<LinkIntakeResult> {
  const { formId, firmId, clientId, actorId } = args;

  const [client] = await db
    .select({ householdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client?.householdId) return "client_not_found";
  const householdId = client.householdId;

  const outcome = await db.transaction(async (tx) => {
    // Locked: a client upload on this form's public link resolves its household
    // under the same lock, so it lands either before the move or on the client.
    const [form] = await tx
      .select({
        status: intakeForms.status,
        clientId: intakeForms.clientId,
        crmHouseholdId: intakeForms.crmHouseholdId,
      })
      .from(intakeForms)
      .where(and(eq(intakeForms.id, formId), eq(intakeForms.firmId, firmId)))
      .for("update");
    if (!form) return "form_not_found" as const;
    if (!canLinkToClient(form)) return "conflict" as const;

    await tx
      .update(intakeForms)
      .set({ clientId, crmHouseholdId: null, updatedAt: new Date() })
      .where(eq(intakeForms.id, formId));

    const placeholder = form.crmHouseholdId;
    // Same household when the advisor created the client FROM the placeholder
    // in the CRM — the files are already where they belong.
    if (!placeholder || placeholder === householdId) {
      return { placeholder: null, documentsMoved: 0, placeholderTrashed: false };
    }
    return {
      placeholder,
      ...(await adoptParkedUploads(tx, { firmId, placeholder, householdId, actorId })),
    };
  });
  if (typeof outcome === "string") return outcome;

  await recordAudit({
    action: "intake.form.linked",
    resourceType: "intake_form",
    resourceId: formId,
    clientId,
    firmId,
    actorId,
    metadata: outcome,
  });
  return "linked";
}
