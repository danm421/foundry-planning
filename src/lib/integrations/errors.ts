// src/lib/integrations/errors.ts
import type { ProviderId } from "./types";

export class ReconnectRequired extends Error {
  constructor(
    public firmId: string,
    public providerId: ProviderId,
  ) {
    super(`${providerId} connection for ${firmId} needs to be re-authorized`);
    this.name = "ReconnectRequired";
  }
}

/**
 * Thrown by a provider whose transport is not yet implemented (Schwab, pending
 * partner credentials). Distinct from ReconnectRequired: this is a build-state
 * problem, not a user-fixable auth problem, so the UI must not offer "Reconnect".
 */
export class ProviderNotConfigured extends Error {
  constructor(public providerId: ProviderId) {
    super(`${providerId} transport is not yet configured`);
    this.name = "ProviderNotConfigured";
  }
}
