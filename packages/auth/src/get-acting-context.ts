import type { ActingContext, AdminRole } from "./context";
import type { AdminUserRepo } from "./admin-user-repo";

type ClerkSessionSnapshot = {
  userId: string;
  emailAddress: string;
  role?: AdminRole;
} | null;

export type GetActingContextInput = {
  clerkSession: ClerkSessionSnapshot;
  repo: AdminUserRepo;
};

export class AdminAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export async function getActingContext(
  input: GetActingContextInput,
): Promise<ActingContext> {
  const { clerkSession, repo } = input;
  if (!clerkSession) {
    throw new AdminAuthError("Admin not authenticated", 401);
  }

  let row = await repo.findByClerkUserId(clerkSession.userId);
  if (!row) {
    if (!clerkSession.role) {
      throw new AdminAuthError("Missing admin role on Clerk user", 403);
    }
    row = await repo.createFromClerk({
      clerkUserId: clerkSession.userId,
      email: clerkSession.emailAddress,
      role: clerkSession.role,
    });
  }

  if (row.disabledAt) {
    throw new AdminAuthError("Admin user is disabled", 403);
  }

  const impersonation = await repo.findActiveImpersonation(row.id);
  return {
    actorAdminId: row.id,
    role: row.role,
    impersonation,
  };
}
