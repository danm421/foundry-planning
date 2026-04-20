import type { AdminRole } from "./context";

export type AdminUserRow = {
  id: string;
  clerkUserId: string;
  email: string;
  role: AdminRole;
  disabledAt: Date | null;
};

export type ActiveImpersonation = {
  sessionId: string;
  advisorClerkUserId: string;
  firmId: string;
};

export type AdminUserRepo = {
  findByClerkUserId(clerkUserId: string): Promise<AdminUserRow | null>;
  createFromClerk(params: {
    clerkUserId: string;
    email: string;
    role: AdminRole;
  }): Promise<AdminUserRow>;
  findActiveImpersonation(
    adminUserId: string,
  ): Promise<ActiveImpersonation | null>;
};
