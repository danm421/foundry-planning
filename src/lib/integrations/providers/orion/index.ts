// src/lib/integrations/providers/orion/index.ts
import type { ProviderDefinition } from "../../types";
import { orionClient } from "./client";
import { orionOAuth } from "./oauth";
import { ORION_REGISTRATIONS } from "./registrations";

export const orionProvider: ProviderDefinition = {
  id: "orion",
  label: "Orion Advisor Tech",
  scope: "firm",
  // Orion has no kill-switch flag: it shipped enabled and is merely awaiting
  // partner credentials, which the env accessors already fail loudly on.
  isEnabled: () => true,
  authKind: "oauth",
  oauth: orionOAuth,
  client: orionClient,
  registrationTable: ORION_REGISTRATIONS,
  autoCommitExact: true,
};
