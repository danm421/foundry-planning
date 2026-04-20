export {
  runWithActingContext,
  getCurrentActingContext,
  type ActingContext,
  type AdminRole,
} from "./context";
export {
  getActingContext,
  AdminAuthError,
  type GetActingContextInput,
} from "./get-acting-context";
export type {
  AdminUserRepo,
  AdminUserRow,
  ActiveImpersonation,
} from "./admin-user-repo";
export { requireRole } from "./roles";
