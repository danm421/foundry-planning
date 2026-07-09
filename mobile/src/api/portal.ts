// mobile/src/api/portal.ts
//
// Endpoint helpers for /api/portal/*. Contract types are imported
// type-only from @contracts (enforced by the mobile build).

import type { PortalDashboardDTO, PortalMeDTO } from "@contracts";
import { ForbiddenError, NonJsonResponseError, type ApiClient } from "./client";

/** Signed in with Clerk, but not a bound portal client (advisor or unbound). */
export class NotPortalClientError extends Error {
  constructor() {
    super("not a portal client");
    this.name = "NotPortalClientError";
  }
}

export async function fetchMe(api: ApiClient): Promise<PortalMeDTO> {
  try {
    return await api.get<PortalMeDTO>("/api/portal/me");
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof NonJsonResponseError) {
      throw new NotPortalClientError();
    }
    throw e;
  }
}

export function fetchDashboard(api: ApiClient): Promise<PortalDashboardDTO> {
  return api.get<PortalDashboardDTO>("/api/portal/dashboard");
}
