// Shared env accessor for the Orion integration. Centralizes the "required env
// var or throw" pattern so client.ts and oauth.ts don't each carry a copy.
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
