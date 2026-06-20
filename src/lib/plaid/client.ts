import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

let _client: PlaidApi | null = null;

/**
 * Returns the lazy-init singleton PlaidApi. Env vars:
 * - PLAID_CLIENT_ID, PLAID_SECRET (required)
 * - PLAID_ENV: "sandbox" | "production" (default "sandbox")
 *   Note: Plaid removed the "development" environment in SDK v42+;
 *   an unknown env value is caught at runtime by the basePath guard below.
 *
 * Matches the lazy-singleton pattern from src/lib/billing/stripe-client.ts.
 */
export function getPlaidClient(): PlaidApi {
  if (_client) return _client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID and PLAID_SECRET env vars are required");
  }
  const envKey = (process.env.PLAID_ENV ??
    "sandbox") as keyof typeof PlaidEnvironments;
  const basePath = PlaidEnvironments[envKey];
  if (!basePath) {
    throw new Error(
      `PLAID_ENV must be sandbox|production (got ${envKey})`,
    );
  }
  _client = new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
          "Plaid-Version": "2020-09-14",
        },
      },
    }),
  );
  return _client;
}
