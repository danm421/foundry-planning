// src/lib/orion/client.ts
import { z } from "zod";
import { getValidAccessToken } from "./auth";
import { requireEnv } from "./env";
import { checkOrionApiLimit } from "@/lib/rate-limit";
import {
  orionHouseholdSchema, orionAccountSchema, orionPositionSchema,
  type OrionHousehold, type OrionAccount, type OrionPosition,
} from "./schemas";

// FINALIZE paths against Orion Portfolio API docs.
const PATHS = {
  households: () => `/v1/portfolio/clients`,
  accounts: (hh: string) => `/v1/portfolio/clients/${encodeURIComponent(hh)}/accounts`,
  positions: (acct: string) => `/v1/portfolio/accounts/${encodeURIComponent(acct)}/positions`,
};

export class OrionClient {
  private firmId: string;
  private fetchImpl: typeof fetch;
  private baseUrl: string;

  constructor(opts: { firmId: string; fetchImpl?: typeof fetch; baseUrl?: string }) {
    this.firmId = opts.firmId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? requireEnv("ORION_API_BASE");
  }

  getHouseholds(): Promise<OrionHousehold[]> {
    return this.getList(PATHS.households(), orionHouseholdSchema);
  }
  getAccounts(householdId: string): Promise<OrionAccount[]> {
    return this.getList(PATHS.accounts(householdId), orionAccountSchema);
  }
  getPositions(accountId: string): Promise<OrionPosition[]> {
    return this.getList(PATHS.positions(accountId), orionPositionSchema);
  }

  private async getList<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const json = await this.request(path);
    return z.array(schema).parse(json);
  }

  private async request(path: string, attempt = 0, forceRefresh = false): Promise<unknown> {
    const rl = await checkOrionApiLimit(this.firmId);
    if (!rl.allowed) throw new Error("Orion rate limit exceeded");

    const token = await getValidAccessToken(this.firmId, { forceRefresh });
    const res = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 401 && attempt === 0) return this.request(path, attempt + 1, true);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await sleep(retryAfter * 1000);
      return this.request(path, attempt + 1, forceRefresh);
    }
    if (!res.ok) throw new Error(`Orion API ${path} failed: ${res.status}`);
    return res.json();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
