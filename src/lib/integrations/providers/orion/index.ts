// src/lib/integrations/providers/orion/index.ts
import type { ProviderDefinition } from "../../types";
import { orionClient } from "./client";
import { isOrionEnabled } from "./flag";
import { orionOAuth } from "./oauth";
import { ORION_REGISTRATIONS } from "./registrations";

export const orionProvider: ProviderDefinition = {
  id: "orion",
  label: "Orion Advisor Tech",
  scope: "firm",
  isEnabled: isOrionEnabled,
  authKind: "oauth",
  oauth: orionOAuth,
  syncs: true,
  client: orionClient,
  registrationTable: ORION_REGISTRATIONS,
  autoCommitExact: true,
};
