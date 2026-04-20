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
export {
  getAdvisorContext,
  getAdvisorContextOrFallback,
  installClerkAdvisorFallback,
  runWithAdvisorContext,
} from './advisor-context';
export type { AdvisorContext } from './advisor-context';
export { signImpersonationToken, verifyImpersonationToken, hashImpersonationToken, ImpersonationTokenError } from './impersonation-token';
export type { ImpersonationClaims } from './impersonation-token';
export type { ImpersonationSessionRepo, ActiveImpersonationSession } from './impersonation-session-repo';
