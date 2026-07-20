// src/lib/integrations/providers/orion/client.ts
import { z } from "zod";
import { checkIntegrationApiLimit } from "@/lib/rate-limit";
import { requireEnv } from "../../env";
import type {
  ProviderAccount,
  ProviderCallContext,
  ProviderClient,
  ProviderHousehold,
  ProviderPosition,
} from "../../types";
import { orionAccountSchema, orionHouseholdSchema, orionPositionSchema } from "./schemas";

// FINALIZE paths against Orion Portfolio API docs.
const PATHS = {
  households: () => `/v1/portfolio/clients`,
  accounts: (hh: string) => `/v1/portfolio/clients/${encodeURIComponent(hh)}/accounts`,
  positions: (acct: string) => `/v1/portfolio/accounts/${encodeURIComponent(acct)}/positions`,
};

export const orionClient: ProviderClient = {
  async getHouseholds(ctx) {
    const rows = await getList(ctx, PATHS.households(), orionHouseholdSchema);
    return rows.map((r): ProviderHousehold => ({ id: r.id, name: r.name }));
  },
  async getAccounts(ctx, householdId) {
    const rows = await getList(ctx, PATHS.accounts(householdId), orionAccountSchema);
    return rows.map(
      (r): ProviderAccount => ({
        id: r.id,
        name: r.name,
        registrationType: r.registrationType,
        custodian: r.custodian,
        accountNumber: r.accountNumber,
        value: r.value,
        costBasis: r.costBasis,
      }),
    );
  },
  async getPositions(ctx, accountId) {
    const rows = await getList(ctx, PATHS.positions(accountId), orionPositionSchema);
    return rows.map(
      (r): ProviderPosition => ({
        ticker: r.ticker,
        cusip: r.cusip,
        description: r.description,
        units: r.units,
        price: r.price,
        marketValue: r.marketValue,
        costBasis: r.costBasis,
      }),
    );
  },
};

async function getList<T>(
  ctx: ProviderCallContext,
  path: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const json = await request(ctx, path);
  return z.array(schema).parse(json);
}

async function request(
  ctx: ProviderCallContext,
  path: string,
  attempt = 0,
  forceRefresh = false,
): Promise<unknown> {
  const rl = await checkIntegrationApiLimit(`${ctx.providerId}:${ctx.firmId}`);
  if (!rl.allowed) throw new Error("Orion rate limit exceeded");

  const token = await ctx.getToken({ forceRefresh });
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const baseUrl = ctx.baseUrl ?? requireEnv("ORION_API_BASE");
  const res = await fetchImpl(new URL(path, baseUrl).toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 401 && attempt === 0) return request(ctx, path, attempt + 1, true);
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await sleep(retryAfter * 1000);
    return request(ctx, path, attempt + 1, forceRefresh);
  }
  if (!res.ok) throw new Error(`Orion API ${path} failed: ${res.status}`);
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
