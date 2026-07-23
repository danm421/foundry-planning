// Capability model for org roles. Roles map to capability sets; route handlers
// and the proxy gate on capabilities (or the staff-role flag), never on raw
// role strings scattered across the codebase. "advisor" is the concept spanning
// owner/admin/member (firm-wide); operations/planner are the new staff roles.
export type Capability =
  | "planning:read"
  | "planning:write"
  | "crm:read"
  | "crm:write"
  | "tasks:read"
  | "tasks:write"
  | "firm:config"
  | "team:manage"
  | "billing:manage";

const PLANNING: Capability[] = ["planning:read", "planning:write"];
const CRM: Capability[] = ["crm:read", "crm:write"];
const TASKS: Capability[] = ["tasks:read", "tasks:write"];

// DORMANT (pending the Clerk B2B "Roles & Permissions" add-on): org:owner,
// org:operations, and org:planner are retired from the live path but kept here
// so reactivation = recreate the Clerk roles + re-point provisioning. No user
// can hold these keys today, so the extra entries are inert. Live roles:
// org:admin, org:member. See spec 2026-06-11-role-downgrade-admin-member.
//
// 2026-07-23: org:operations and org:planner were also DELETED from the Clerk
// Dashboard (they lingered as selectable roles in the OrganizationProfile invite
// picker and billed as custom-role add-ons). They no longer exist in Clerk — so
// reactivation means recreating them in the Dashboard with these SAME keys
// (org:operations / org:planner), at which point the entries below re-light with
// no code change. Kept here deliberately for that path.
const ROLE_CAPABILITIES: Record<string, ReadonlySet<Capability>> = {
  "org:owner": new Set<Capability>([
    ...PLANNING,
    ...CRM,
    ...TASKS,
    "firm:config",
    "team:manage",
    "billing:manage",
  ]),
  "org:admin": new Set<Capability>([
    ...PLANNING,
    ...CRM,
    ...TASKS,
    "firm:config",
    "team:manage",
  ]),
  "org:member": new Set<Capability>([...PLANNING, ...CRM, ...TASKS]),
  "org:operations": new Set<Capability>([...CRM, ...TASKS]),
  "org:planner": new Set<Capability>([...PLANNING, ...CRM, ...TASKS]),
};

// Staff roles are book-scoped (resolver returns a finite advisor set); the
// firm-wide roles (owner/admin/member) are NOT in this set.
export const STAFF_ROLES = new Set<string>(["org:operations", "org:planner"]);

export function roleHasCapability(
  role: string | null | undefined,
  cap: Capability,
): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.has(cap) ?? false;
}
