/**
 * Annotates audit metadata when a mutation is performed by a cross-firm
 * shared-edit recipient. Mirrors the impersonation annotation in recordAudit
 * (which stamps `actingAsAdvisor` in jsonb metadata): when the caller is acting
 * on a client SHARED to them from another firm, we stamp who really did it.
 *
 * - access.access === "shared": merge { crossFirmActor: true, actorFirmId: callerOrgId } into base.
 * - access.access === "own": return base unchanged.
 */
export function crossFirmAuditMeta(
  access: { access: "own" | "shared" },
  callerOrgId: string | null,
  base?: Record<string, unknown>,
): Record<string, unknown> {
  if (access.access === "shared") {
    return { ...(base ?? {}), crossFirmActor: true, actorFirmId: callerOrgId };
  }
  return base ?? {};
}
