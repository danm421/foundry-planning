// src/lib/integrations/providers/schwab/client.ts
import { ProviderNotConfigured } from "../../errors";
import type { ProviderClient } from "../../types";

/** STUB — see ./oauth.ts. Parses into ./schemas.ts once endpoints are known. */
export const schwabClient: ProviderClient = {
  async getHouseholds() {
    throw new ProviderNotConfigured("schwab");
  },
  async getAccounts() {
    throw new ProviderNotConfigured("schwab");
  },
  async getPositions() {
    throw new ProviderNotConfigured("schwab");
  },
};
