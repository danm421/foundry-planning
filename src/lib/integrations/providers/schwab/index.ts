// src/lib/integrations/providers/schwab/index.ts
import type { ProviderDefinition } from "../../types";
import { schwabClient } from "./client";
import { isSchwabEnabled } from "./flag";
import { schwabOAuth } from "./oauth";
import { SCHWAB_REGISTRATIONS } from "./registrations";

export const schwabProvider: ProviderDefinition = {
  id: "schwab",
  label: "Schwab Advisor Services",
  scope: "firm",
  isEnabled: isSchwabEnabled,
  oauth: schwabOAuth,
  client: schwabClient,
  registrationTable: SCHWAB_REGISTRATIONS,
};
