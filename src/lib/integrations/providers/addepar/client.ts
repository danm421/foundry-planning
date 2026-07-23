// src/lib/integrations/providers/addepar/client.ts
//
// VERIFY: Addepar Portfolio Query API may be async (submit→poll→fetch). This
// implements the synchronous request shape; confirm paths/envelopes/async-
// polling against Addepar API docs before production use.
import { checkIntegrationApiLimit } from "@/lib/rate-limit";
import type {
  ProviderAccount,
  ProviderCallContext,
  ProviderClient,
  ProviderHousehold,
  ProviderPosition,
} from "../../types";
import { decodeAddeparSecret } from "./credentials";
import { addeparAccountSchema, addeparHouseholdSchema, addeparPositionSchema } from "./schemas";

// VERIFY paths + envelope + async-query behavior against Addepar API docs.
const PATHS = {
  households: () => `/v1/groups`,
  accounts: (hh: string) => `/v1/groups/${encodeURIComponent(hh)}/entities`,
  positions: (acct: string) => `/v1/entities/${encodeURIComponent(acct)}/positions`,
};

function basicAuth(token: string): string {
  const { apiKey, apiSecret } = decodeAddeparSecret(token);
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}

async function request(ctx: ProviderCallContext, path: string, attempt = 0): Promise<unknown> {
  const rl = await checkIntegrationApiLimit(`${ctx.providerId}:${ctx.firmId}`);
  if (!rl.allowed) throw new Error("Addepar rate limit exceeded");

  // BYOK credentials are a static API key/secret pair — there's no refresh
  // token to rotate, unlike Orion's OAuth flow, so `forceRefresh` never
  // varies across attempts here.
  const token = await ctx.getToken({ forceRefresh: false });
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const baseUrl = ctx.baseUrl ?? "https://api.addepar.com";
  const res = await fetchImpl(new URL(path, baseUrl).toString(), {
    headers: { Authorization: basicAuth(token), Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 401 && attempt === 0) return request(ctx, path, attempt + 1);
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await sleep(retryAfter * 1000);
    return request(ctx, path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Addepar API ${path} failed: ${res.status}`);
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const addeparClient: ProviderClient = {
  async getHouseholds(ctx) {
    const body = (await request(ctx, PATHS.households())) as { households?: unknown[] };
    return (body.households ?? []).map((r): ProviderHousehold => addeparHouseholdSchema.parse(r));
  },
  async getAccounts(ctx, householdId) {
    const body = (await request(ctx, PATHS.accounts(householdId))) as { entities?: unknown[] };
    return (body.entities ?? []).map((r): ProviderAccount => addeparAccountSchema.parse(r));
  },
  async getPositions(ctx, accountId) {
    const body = (await request(ctx, PATHS.positions(accountId))) as { positions?: unknown[] };
    return (body.positions ?? []).map((r): ProviderPosition => addeparPositionSchema.parse(r));
  },
};

/** One lightweight read used by the connect flow to validate credentials. */
export async function testAddeparConnection(ctx: ProviderCallContext): Promise<void> {
  await addeparClient.getHouseholds(ctx);
}
