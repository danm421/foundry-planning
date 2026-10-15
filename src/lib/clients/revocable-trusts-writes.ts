// Revocable living trust write core: the create and update paths of POST
// /api/clients/[id]/revocable-trusts and PATCH …/[trustId], moved verbatim so
// the fact finder save can run them on its transaction (Plan 4, D3). The
// routes keep their gates, their responses and DELETE.
//
// Neither path is atomic without `tx`, as before; with `tx` every statement and
// the audit row run on it. A body without `accountIds` parses to [] — the
// update then untags every account of the trust (the route's contract, kept;
// the save's writer sends the trust's current accounts). Without `actorId` the
// audit actor comes from the Clerk session, as before.
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, revocableTrusts } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { handleOf, type DbOrTx, type WriteOptions } from "@/lib/db-tx";
import { formatZodIssues } from "@/lib/schemas/common";
import { revocableTrustUpsertSchema } from "@/lib/schemas/revocable-trusts";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type RevocableTrustRow = typeof revocableTrusts.$inferSelect;

/** Verify the trust row belongs to clientId (and thus firmId by FK chain).
 *  Returns the trust row or null. The PATCH route runs it before it reads the
 *  body (a missing trust answers 404 whatever the body), the update core again
 *  on its handle; DELETE runs it too. */
export async function verifyTrust(trustId: string, clientId: string, handle?: DbOrTx) {
  const [trust] = await (handle ?? db)
    .select()
    .from(revocableTrusts)
    .where(
      and(eq(revocableTrusts.id, trustId), eq(revocableTrusts.clientId, clientId))
    );
  return trust ?? null;
}

export async function createRevocableTrustForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<RevocableTrustRow & { accountIds: string[] }>> {
  const { clientId: id, firmId, actorId, input: body, crossFirmMeta } = args;
  const handle = handleOf(args);

  const parsed = revocableTrustUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(parsed.error) });
  }
  const { name, accountIds } = parsed.data;

  const [trust] = await handle
    .insert(revocableTrusts)
    .values({ clientId: id, name })
    .returning();

  // Tag the specified accounts into this trust (scope to clientId for safety)
  if (accountIds.length > 0) {
    await handle
      .update(accounts)
      .set({ revocableTrustId: trust.id })
      .where(
        and(
          eq(accounts.clientId, id),
          inArray(accounts.id, accountIds)
        )
      );
  }

  await recordAudit({
    action: "revocable_trust.create",
    resourceType: "revocable_trust",
    resourceId: trust.id,
    clientId: id,
    firmId,
    metadata: { name: trust.name, accountIds, ...crossFirmMeta },
    actorId,
    tx: args.tx,
  });

  return { ok: true, data: { ...trust, accountIds }, resourceId: trust.id };
}

export async function updateRevocableTrustForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    trustId: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<RevocableTrustRow & { accountIds: string[] }>> {
  const { clientId: id, firmId, actorId, trustId, input: body, crossFirmMeta } = args;
  const handle = handleOf(args);

  const trust = await verifyTrust(trustId, id, args.tx);
  if (!trust) {
    return writeError(404, "Trust not found");
  }

  const parsed = revocableTrustUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(parsed.error) });
  }
  const { name, accountIds } = parsed.data;

  // Update the trust name
  const [updated] = await handle
    .update(revocableTrusts)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(revocableTrusts.id, trustId), eq(revocableTrusts.clientId, id)))
    .returning();

  // Membership diff:
  // (a) Untag accounts currently in this trust but not in the new accountIds list
  // (b) Tag accounts in the new accountIds list

  // (a) Clear revocable_trust_id on accounts tagged to this trust that are no
  //     longer in accountIds. If accountIds is empty, untag ALL currently tagged
  //     accounts for this trust.
  if (accountIds.length > 0) {
    await handle
      .update(accounts)
      .set({ revocableTrustId: null })
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.revocableTrustId, trustId),
          notInArray(accounts.id, accountIds)
        )
      );
  } else {
    // Empty accountIds: untag all accounts currently in this trust
    await handle
      .update(accounts)
      .set({ revocableTrustId: null })
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.revocableTrustId, trustId)
        )
      );
  }

  // (b) Tag the new accountIds (scope to clientId)
  if (accountIds.length > 0) {
    await handle
      .update(accounts)
      .set({ revocableTrustId: trustId })
      .where(
        and(
          eq(accounts.clientId, id),
          inArray(accounts.id, accountIds)
        )
      );
  }

  // Fetch the final account membership for the response
  const taggedAccounts = await handle
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.clientId, id),
        eq(accounts.revocableTrustId, trustId)
      )
    );
  const finalAccountIds = taggedAccounts.map((a) => a.id);

  await recordAudit({
    action: "revocable_trust.update",
    resourceType: "revocable_trust",
    resourceId: trustId,
    clientId: id,
    firmId,
    metadata: { name, accountIds: finalAccountIds, ...crossFirmMeta },
    actorId,
    tx: args.tx,
  });

  return { ok: true, data: { ...updated, accountIds: finalAccountIds }, resourceId: trustId };
}
