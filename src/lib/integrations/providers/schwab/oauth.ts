// src/lib/integrations/providers/schwab/oauth.ts
import { ProviderNotConfigured } from "../../errors";
import type { ProviderOAuth } from "../../types";

/**
 * STUB. Schwab Advisor Services partner credentials do not exist yet, so there
 * is no verified authorize/token endpoint to code against. Implement against
 * the real contract when creds land; the port and every caller already work.
 */
export const schwabOAuth: ProviderOAuth = {
  buildAuthorizeUrl() {
    throw new ProviderNotConfigured("schwab");
  },
  async exchangeCodeForTokens() {
    throw new ProviderNotConfigured("schwab");
  },
  async refreshTokens() {
    throw new ProviderNotConfigured("schwab");
  },
};
