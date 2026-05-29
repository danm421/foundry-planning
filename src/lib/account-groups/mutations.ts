import { db } from "@/db";
import {
  accountGroups,
  accountGroupMembers,
  accounts,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { isLiquid, type AccountCategory } from "./liquid-filter";
import type {
  CreateAccountGroupInput,
  UpdateAccountGroupInput,
} from "./schemas";

export const RESERVED_DEFAULT_KEYS = new Set([
  "all-liquid",
  "taxable",
  "retirement",
  "cash",
]);

export function isReservedName(name: string): boolean {
  return RESERVED_DEFAULT_KEYS.has(name.trim().toLowerCase());
}

export class MemberValidationError extends Error {
  constructor(
    public readonly reason: "cross-client" | "illiquid" | "unknown",
    public readonly accountIds: string[],
  ) {
    super(
      `Invalid account-group members (${reason}): ${accountIds.join(", ")}`,
    );
  }
}

export class NameCollisionError extends Error {
  constructor(public readonly name: string) {
    super(`Account group name already exists: ${name}`);
  }
}

export class ReservedNameError extends Error {
  constructor(public readonly name: string) {
    super(`Account group name is reserved: ${name}`);
  }
}

export class GroupNotFoundError extends Error {
  constructor(public readonly groupId: string) {
    super(`Account group not found: ${groupId}`);
  }
}

type ClientAccount = {
  id: string;
  clientId: string;
  category: AccountCategory;
};

/** Pure validator — throws MemberValidationError on any rejection. */
export function validateMembers(
  clientId: string,
  requestedIds: string[],
  clientAccounts: ClientAccount[],
): void {
  if (requestedIds.length === 0) return;
  const byId = new Map(clientAccounts.map((a) => [a.id, a]));
  const unknown: string[] = [];
  const crossClient: string[] = [];
  const illiquid: string[] = [];
  for (const id of requestedIds) {
    const a = byId.get(id);
    if (!a) { unknown.push(id); continue; }
    if (a.clientId !== clientId) { crossClient.push(id); continue; }
    if (!isLiquid(a.category)) { illiquid.push(id); continue; }
  }
  if (unknown.length) throw new MemberValidationError("unknown", unknown);
  if (crossClient.length) throw new MemberValidationError("cross-client", crossClient);
  if (illiquid.length) throw new MemberValidationError("illiquid", illiquid);
}

async function loadClientAccounts(clientId: string): Promise<ClientAccount[]> {
  const rows = await db
    .select({ id: accounts.id, clientId: accounts.clientId, category: accounts.category })
    .from(accounts)
    .where(eq(accounts.clientId, clientId));
  return rows.map((r) => ({ id: r.id, clientId: r.clientId, category: r.category as AccountCategory }));
}

async function loadCollidingName(
  clientId: string,
  name: string,
  excludeGroupId?: string,
): Promise<boolean> {
  const trimmed = name.trim();
  const rows = await db
    .select({ id: accountGroups.id })
    .from(accountGroups)
    .where(
      and(
        eq(accountGroups.clientId, clientId),
        sql`LOWER(${accountGroups.name}) = LOWER(${trimmed})`,
      ),
    );
  return rows.some((r) => r.id !== excludeGroupId);
}

export async function createAccountGroup(
  clientId: string,
  input: CreateAccountGroupInput,
): Promise<{ id: string }> {
  if (isReservedName(input.name)) throw new ReservedNameError(input.name);
  if (await loadCollidingName(clientId, input.name)) {
    throw new NameCollisionError(input.name);
  }
  const clientAccounts = await loadClientAccounts(clientId);
  validateMembers(clientId, input.memberAccountIds, clientAccounts);

  const [row] = await db
    .insert(accountGroups)
    .values({
      clientId,
      name: input.name.trim(),
      description: input.description ?? null,
      color: input.color ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning({ id: accountGroups.id });

  if (input.memberAccountIds.length > 0) {
    await db.insert(accountGroupMembers).values(
      input.memberAccountIds.map((accountId) => ({
        accountGroupId: row.id,
        accountId,
      })),
    );
  }

  return { id: row.id };
}

export async function updateAccountGroup(
  clientId: string,
  groupId: string,
  input: UpdateAccountGroupInput,
): Promise<void> {
  // Authorization: verify the group exists and belongs to this client before any write.
  const [owned] = await db
    .select({ id: accountGroups.id })
    .from(accountGroups)
    .where(and(eq(accountGroups.id, groupId), eq(accountGroups.clientId, clientId)));
  if (!owned) throw new GroupNotFoundError(groupId);

  if (input.name !== undefined) {
    if (isReservedName(input.name)) throw new ReservedNameError(input.name);
    if (await loadCollidingName(clientId, input.name, groupId)) {
      throw new NameCollisionError(input.name);
    }
  }
  if (input.memberAccountIds !== undefined) {
    const clientAccounts = await loadClientAccounts(clientId);
    validateMembers(clientId, input.memberAccountIds, clientAccounts);
  }

  // Build a typed patch — only include fields that were supplied.
  type GroupPatch = Partial<typeof accountGroups.$inferInsert>;
  const patch: GroupPatch = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.color !== undefined) patch.color = input.color ?? null;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  await db.update(accountGroups).set(patch).where(and(eq(accountGroups.id, groupId), eq(accountGroups.clientId, clientId)));

  if (input.memberAccountIds !== undefined) {
    // Full-replace semantics: delete all then insert the new set.
    await db
      .delete(accountGroupMembers)
      .where(eq(accountGroupMembers.accountGroupId, groupId));
    if (input.memberAccountIds.length > 0) {
      await db.insert(accountGroupMembers).values(
        input.memberAccountIds.map((accountId) => ({
          accountGroupId: groupId,
          accountId,
        })),
      );
    }
  }
}

export async function deleteAccountGroup(
  clientId: string,
  groupId: string,
): Promise<void> {
  // Members cascade via FK on delete.
  await db
    .delete(accountGroups)
    .where(and(eq(accountGroups.id, groupId), eq(accountGroups.clientId, clientId)));
}
