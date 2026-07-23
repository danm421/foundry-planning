// src/lib/integrations/registry.ts
import { addeparProvider } from "./providers/addepar";
import { orionProvider } from "./providers/orion";
import { schwabProvider } from "./providers/schwab";
import { PROVIDER_IDS, type ProviderDefinition, type ProviderId } from "./types";

const REGISTRY: Record<ProviderId, ProviderDefinition> = {
  orion: orionProvider,
  schwab: schwabProvider,
  addepar: addeparProvider,
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function getProvider(id: ProviderId): ProviderDefinition {
  return REGISTRY[id];
}

export function listProviders(): ProviderDefinition[] {
  return PROVIDER_IDS.map((id) => REGISTRY[id]);
}
