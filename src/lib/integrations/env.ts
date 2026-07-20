// src/lib/integrations/env.ts
// Shared "required env var or throw" accessor. Centralizes the pattern so each
// provider's oauth.ts and client.ts don't carry a copy.
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
