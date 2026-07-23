// src/lib/integrations/providers/addepar/index.ts
import type { ProviderDefinition } from "../../types";
import { addeparClient } from "./client";
import { isAddeparEnabled } from "./flag";
import { ADDEPAR_REGISTRATIONS } from "./registrations";

export const addeparProvider: ProviderDefinition = {
  id: "addepar",
  label: "Addepar",
  scope: "firm",
  isEnabled: isAddeparEnabled,
  authKind: "byok",
  client: addeparClient,
  registrationTable: ADDEPAR_REGISTRATIONS,
  autoCommitExact: false,
};
