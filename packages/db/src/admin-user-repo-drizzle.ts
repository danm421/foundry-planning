import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./index";
import { adminUsers, adminImpersonationSessions } from "./schema";
import type {
  AdminUserRepo,
  AdminUserRow,
  ActiveImpersonation,
} from "@foundry/auth";

export const drizzleAdminUserRepo: AdminUserRepo = {
  async findByClerkUserId(clerkUserId: string): Promise<AdminUserRow | null> {
    const rows = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.clerkUserId, clerkUserId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      clerkUserId: row.clerkUserId,
      email: row.email,
      role: row.role as AdminUserRow["role"],
      disabledAt: row.disabledAt ?? null,
    };
  },

  async createFromClerk(params): Promise<AdminUserRow> {
    const [row] = await db
      .insert(adminUsers)
      .values({
        clerkUserId: params.clerkUserId,
        email: params.email,
        role: params.role,
      })
      .returning();
    return {
      id: row.id,
      clerkUserId: row.clerkUserId,
      email: row.email,
      role: row.role as AdminUserRow["role"],
      disabledAt: null,
    };
  },

  async findActiveImpersonation(
    adminUserId: string,
  ): Promise<ActiveImpersonation | null> {
    const rows = await db
      .select()
      .from(adminImpersonationSessions)
      .where(
        and(
          eq(adminImpersonationSessions.adminUserId, adminUserId),
          isNull(adminImpersonationSessions.endedAt),
          gt(adminImpersonationSessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(adminImpersonationSessions.startedAt)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.id,
      advisorClerkUserId: row.advisorClerkUserId,
      firmId: row.firmId,
    };
  },
};
