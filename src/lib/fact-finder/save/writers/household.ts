// src/lib/fact-finder/save/writers/household.ts
/**
 * The household's save writers (Plan 4, Task 5). The household and its tax
 * settings are update-only (their records are the client and the base case's
 * settings); a family member is created or updated. Each goes through its
 * Details core on the save's transaction, so a co-client the household line
 * adds — their contact and family member — is there for every line after it.
 * What those cores don't write the writer writes: each person's employer (on
 * their CRM contact) and a new family member's claimedAsDependent (the create
 * schema drops it).
 */
import { and, eq } from "drizzle-orm";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { updateClientProfileForClient } from "@/lib/clients/client-profile-writes";
import { createFamilyMemberForClient, updateFamilyMemberForClient } from "@/lib/clients/family-members-writes";
import { updatePlanSettingsForClient } from "@/lib/clients/plan-settings-writes";
import { upsertPrimaryAndSpouseContacts } from "@/lib/crm/upsert-household-contact";
import { NO_CO_CLIENT_REASON } from "../../placement/refs";
import { coreArgs, recordIdOf, SaveLineError, unwrap, type SaveContext, type SaveWriter } from "../types";

const updateOnly = (message: string) => async (): Promise<string> => {
  throw new SaveLineError(message);
};

/** The household and whether it has a co-client, read on the save's transaction. */
async function householdOf(ctx: SaveContext): Promise<{ householdId: string; hasCoClient: boolean }> {
  const [client] = await ctx.tx
    .select({ householdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.firmId)));
  if (!client) throw new SaveLineError("Client not found");
  const [spouse] = await ctx.tx
    .select({ id: crmHouseholdContacts.id })
    .from(crmHouseholdContacts)
    .where(and(eq(crmHouseholdContacts.householdId, client.householdId), eq(crmHouseholdContacts.role, "spouse")));
  return { householdId: client.householdId, hasCoClient: !!spouse };
}

export const HOUSEHOLD_WRITERS: { client_household: SaveWriter; plan_settings_tax_rates: SaveWriter; family_member: SaveWriter } = {
  client_household: {
    create: updateOnly("A household is only ever updated."),
    async update(ctx, { values, body }) {
      // An Employer line carries no profile keys: the profile update would write nothing but timestamps.
      if (Object.keys(body).length > 0) unwrap(await updateClientProfileForClient({ ...coreArgs(ctx), body }));
      const touchesCoClient = Object.keys(values).some((key) => key.startsWith("spouse"));
      if (!touchesCoClient && !("employer" in values)) return;

      const { householdId, hasCoClient } = await householdOf(ctx);
      // A co-client value on a plan with no co-client, and none this line adds: the profile update has
      // planned for someone who isn't there (a date of birth moves the plan end) and an employer would
      // land on no contact. Refuse — the save rolls back.
      if (touchesCoClient && !hasCoClient) throw new SaveLineError(NO_CO_CLIENT_REASON);
      if (!("employer" in values) && !("spouseEmployer" in values)) return;
      const employer = (key: string) => (key in values ? { employer: values[key] } : undefined);
      await upsertPrimaryAndSpouseContacts(ctx.tx, householdId, { primary: employer("employer"), spouse: employer("spouseEmployer") });
    },
  },

  plan_settings_tax_rates: {
    create: updateOnly("Tax settings are only ever updated."),
    async update(ctx, { body }) {
      unwrap(await updatePlanSettingsForClient({ ...coreArgs(ctx), body }));
    },
  },

  family_member: {
    async create(ctx, { body }) {
      const { resourceId } = unwrap(await createFamilyMemberForClient({ ...coreArgs(ctx), input: body }));
      if (body.claimedAsDependent !== undefined) {
        unwrap(await updateFamilyMemberForClient({ ...coreArgs(ctx), memberId: resourceId, input: { claimedAsDependent: body.claimedAsDependent } }));
      }
      return resourceId;
    },
    async update(ctx, input) {
      unwrap(await updateFamilyMemberForClient({ ...coreArgs(ctx), memberId: recordIdOf(input, "This line names no record to update."), input: input.body }));
    },
  },
};
