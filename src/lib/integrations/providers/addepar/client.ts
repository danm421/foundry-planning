// src/lib/integrations/providers/addepar/client.ts
//
// Addepar's REST API, per developers.addepar.com (read 2026-10-21). Every
// request carries HTTP Basic auth and the Addepar-Firm header; replies are
// JSON:API. Households are Addepar groups. A household's accounts, values and
// holdings come from ONE Portfolio Query, because Addepar caps a firm at 50
// requests per 15 minutes — a query per account would spend that on a few
// households.
//
// The Jobs API (async queries) isn't used: Addepar points to it for
// "large-scale" queries that outrun its 60-second limit, and one household's
// holdings isn't that. If a live firm gets "API request timeout exceeded",
// move portfolioQuery onto /v1/jobs.
import { checkIntegrationApiLimit } from "@/lib/rate-limit";
import { CredentialsRejected } from "../../errors";
import type {
  ProviderAccount,
  ProviderCallContext,
  ProviderClient,
  ProviderHousehold,
  ProviderPosition,
} from "../../types";
import { decodeAddeparSecret } from "./credentials";
import { addeparGroupsPageSchema, portfolioQueryReplySchema, type PortfolioNode } from "./schemas";

function addeparConfig(ctx: ProviderCallContext): { apiBase: string; addeparFirmId: string } {
  if (!ctx.config) throw new Error("Addepar call is missing the firm's Addepar address and firm ID");
  return ctx.config;
}

/**
 * The one place an Addepar URL is built. Per the docs' URLs page a firm's own
 * host serves the API under /api and api.addepar.com serves it at the root, so
 * whatever path the admin typed (/api, /api/v1, a trailing slash) is dropped.
 * Paths — Addepar's own `links.next` included — start at the API root
 * ("/v1/…"); requiring that keeps every request on the firm's Addepar host.
 */
function addeparUrl(apiBase: string, path: string): string {
  if (!path.startsWith("/v1/")) throw new Error(`Unexpected Addepar path: ${path}`);
  const { origin, hostname } = new URL(apiBase);
  return `${hostname === "api.addepar.com" ? origin : `${origin}/api`}${path}`;
}

function basicAuth(token: string): string {
  const { apiKey, apiSecret } = decodeAddeparSecret(token);
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}

/** GET when `body` is absent, POST (JSON:API) when present. */
async function request(
  ctx: ProviderCallContext,
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<unknown> {
  const rl = await checkIntegrationApiLimit(`${ctx.providerId}:${ctx.firmId}`);
  if (!rl.allowed) throw new Error("Addepar rate limit exceeded");

  const { apiBase, addeparFirmId } = addeparConfig(ctx);
  const post = body !== undefined;
  // BYOK credentials are a static API key/secret pair — there's no refresh
  // token to rotate, unlike Orion's OAuth flow.
  const token = await ctx.getToken({ forceRefresh: false });
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const res = await fetchImpl(addeparUrl(apiBase, path), {
    method: post ? "POST" : "GET",
    headers: {
      Authorization: basicAuth(token),
      "Addepar-Firm": addeparFirmId,
      ...(post ? { "Content-Type": "application/vnd.api+json" } : {}),
    },
    body: post ? JSON.stringify(body) : undefined,
    // Addepar cancels any request still running at 60 s, with a 400.
    signal: AbortSignal.timeout(60_000),
  });

  if (res.status === 401) {
    // Addepar's docs name these three as the causes of a 401.
    throw new CredentialsRejected(
      "Addepar didn't accept these credentials. Check the API key, secret and firm ID.",
    );
  }
  if (res.status === 429) {
    // The limits run over 15-minute and 24-hour windows, so no short wait helps.
    const wait = Number(res.headers.get("x-ratelimit-retry-after"));
    throw new Error(
      `Addepar's request limit for this firm is used up${wait > 0 ? `; it resets in about ${Math.ceil(wait / 60)} min` : ""}`,
    );
  }
  // A portfolio query isn't re-sent: each try spends one of the firm's 50
  // requests per 15 minutes, and the query can take up to 60 s to fail again.
  if (res.status >= 500 && !post && attempt < 3) {
    await sleep(2 ** attempt * 1000);
    return request(ctx, path, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`Addepar ${path.split("?")[0]} failed: ${res.status}${await errorDetail(res)}`);
  return res.json();
}

/** Addepar explains a failure in the JSON:API `errors[].detail` (docs: Response Codes). */
async function errorDetail(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { errors?: { detail?: unknown }[] } | null;
  const detail = body?.errors?.[0]?.detail;
  return typeof detail === "string" ? ` — ${detail}` : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getGroups(ctx: ProviderCallContext): Promise<ProviderHousehold[]> {
  const households: ProviderHousehold[] = [];
  // 2,000 is Addepar's largest page; every page costs one of the firm's requests.
  let next: string | null | undefined = "/v1/groups?fields[groups]=name&page[limit]=2000";
  while (next) {
    const page = addeparGroupsPageSchema.parse(await request(ctx, next));
    households.push(...page.data.map((g) => ({ id: g.id, name: g.attributes.name })));
    next = page.links?.next;
  }
  return households;
}

async function portfolioQuery(ctx: ProviderCallContext, householdId: string): Promise<PortfolioNode> {
  const portfolioId = Number(householdId);
  if (!Number.isSafeInteger(portfolioId)) throw new Error(`Addepar group id must be a number, got "${householdId}"`);
  // Addepar values are end-of-day; yesterday (UTC) is the latest day that has always closed.
  const asOf = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const reply = await request(ctx, "/v1/portfolio/query", {
    data: {
      type: "portfolio_query",
      attributes: {
        // VERIFY with a live key: a holding's ticker, CUSIP and share count, and
        // an account's number, custodian and tax registration, need column keys
        // the docs don't pin. List them with GET /v1/attributes?filter[usage]=columns.
        columns: [{ key: "value" }, { key: "cost_basis" }],
        groupings: [{ key: "holding_account" }, { key: "position" }],
        portfolio_type: "GROUP",
        portfolio_id: portfolioId,
        start_date: asOf,
        end_date: asOf,
        hide_previous_holdings: true,
      },
    },
  });
  return portfolioQueryReplySchema.parse(reply).data.attributes.total;
}

const num = (node: PortfolioNode, key: string): number | null => {
  const v = node.columns?.[key];
  return typeof v === "number" ? v : null;
};
const minus = (a?: number | null, b?: number | null): number | null => (a == null ? null : a - (b ?? 0));

type AccountHoldings = { account: ProviderAccount; positions: ProviderPosition[] };

/**
 * Walks a holding_account → position tree. A holding_account row with an
 * entity_id is an account; one without ("Directly Owned") hands its positions
 * to the account above it. Accounts can nest (the docs' example has an IRA
 * holding a Pershing account) and a parent's figures include its children's,
 * so each child is taken out of its parent. Positions held outside any
 * account have nowhere to land and are skipped.
 */
function accountsIn(total: PortfolioNode): AccountHoldings[] {
  const found: AccountHoldings[] = [];
  const visit = (node: PortfolioNode, owner: AccountHoldings | undefined) => {
    if (node.grouping === "position") {
      owner?.positions.push({
        description: node.name,
        marketValue: num(node, "value"),
        costBasis: num(node, "cost_basis"),
      });
      return;
    }
    let holder = owner;
    if (node.grouping === "holding_account" && node.entity_id != null) {
      holder = {
        account: {
          id: String(node.entity_id),
          name: node.name,
          // No pinned registration column yet (see VERIFY above); an account's
          // name often carries it ("Adam Smith IRA"), so it stands in for the match.
          registrationType: node.name,
          value: num(node, "value"),
          costBasis: num(node, "cost_basis"),
        },
        positions: [],
      };
      found.push(holder);
      if (owner) {
        owner.account.value = minus(owner.account.value, holder.account.value);
        owner.account.costBasis = minus(owner.account.costBasis, holder.account.costBasis);
      }
    }
    for (const child of node.children ?? []) visit(child, holder);
  };
  visit(total, undefined);
  return found;
}

// Holdings arrive with each household's query in getAccounts; getPositions
// serves them from here, for the life of the caller's call context.
const holdingsByCtx = new WeakMap<ProviderCallContext, Map<string, ProviderPosition[]>>();

export const addeparClient: ProviderClient = {
  getHouseholds: getGroups,
  async getAccounts(ctx, householdId) {
    const found = accountsIn(await portfolioQuery(ctx, householdId));
    const holdings = holdingsByCtx.get(ctx) ?? new Map<string, ProviderPosition[]>();
    holdingsByCtx.set(ctx, holdings);
    for (const { account, positions } of found) holdings.set(account.id, positions);
    return found.map((f) => f.account);
  },
  async getPositions(ctx, accountId) {
    const positions = holdingsByCtx.get(ctx)?.get(accountId);
    if (!positions) {
      throw new Error(`Addepar holdings for account ${accountId} load with its household — call getAccounts first`);
    }
    return positions;
  },
};

/** One lightweight read used by the connect flow to validate credentials. */
export async function testAddeparConnection(ctx: ProviderCallContext): Promise<void> {
  await request(ctx, "/v1/groups?page[limit]=1");
}
