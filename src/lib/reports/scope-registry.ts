import type { ProjectionYear } from "@/engine/types";

export type ScopeKey = "cashflow" | "balance" | "monteCarlo" | "tax" | "estate" | "allocation";

export type ScopeData<S extends ScopeKey = ScopeKey> = unknown;   // each scope narrows

export type ScopeFetchCtx = {
  client: { id: string };
  projection: ProjectionYear[];
};

export type ScopeRegistryEntry = {
  key: ScopeKey;
  label: string;
  fetch: (ctx: ScopeFetchCtx) => Promise<ScopeData> | ScopeData;
  serializeForAI: (data: ScopeData) => string;        // capped ~500 tokens
};

const REGISTRY = new Map<ScopeKey, ScopeRegistryEntry>();

export function registerScope(entry: ScopeRegistryEntry): void {
  REGISTRY.set(entry.key, entry);
}

export function getScope(key: ScopeKey): ScopeRegistryEntry {
  const s = REGISTRY.get(key);
  if (!s) throw new Error(`Unknown scope: ${key}`);
  return s;
}

export function listScopes(): ScopeRegistryEntry[] {
  return [...REGISTRY.values()];
}
