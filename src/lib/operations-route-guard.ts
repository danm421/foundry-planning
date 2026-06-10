// Pure, edge-safe decision for the operations role: which authenticated routes
// it may reach. ALLOWLIST (CRM + Tasks + their APIs + the org picker) rather
// than a planning denylist, so a newly added planning route can't silently leak
// to operations. Tasks data lives under /api/crm/tasks, so /api/crm covers it.
const OPS_ALLOWED_PREFIXES = [
  "/crm",
  "/tasks",
  "/api/crm",
  "/select-organization",
];

export function isOperationsAllowedPath(path: string): boolean {
  return OPS_ALLOWED_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/"),
  );
}

export function operationsBlocked(
  orgRole: string | null | undefined,
  path: string,
): boolean {
  return orgRole === "org:operations" && !isOperationsAllowedPath(path);
}
