// src/lib/integrations/providers/addepar/client.test.ts
//
// Fixtures are the Addepar docs' own example replies (see doc-replies.fixtures.ts).
// They pin the documented shapes only — nothing here was recorded from a live firm.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationApiLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { CredentialsRejected } from "../../errors";
import type { ProviderCallContext } from "../../types";
import { addeparClient, testAddeparConnection } from "./client";
import { encodeAddeparSecret } from "./credentials";
import {
  GROUPS_CHILD_GROUPS,
  GROUPS_GET_ALL,
  PAGINATION_NEXT,
  PORTFOLIO_QUERY_ACCOUNT_WITH_POSITIONS,
  PORTFOLIO_QUERY_COST_BASIS_BY_ACCOUNT,
  PORTFOLIO_VIEW_DIRECTLY_OWNED,
} from "./doc-replies.fixtures";

type Call = { url: string; init: RequestInit };

/** A fetch double that answers each call with the next queued reply and records what it was sent. */
function fakeFetch(...replies: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected extra request: ${String(url)}`);
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function ctxWith(fetchImpl: typeof fetch, apiBase = "https://examplefirm.addepar.com"): ProviderCallContext {
  return {
    providerId: "addepar",
    firmId: "firm_1",
    config: { apiBase, addeparFirmId: "42" },
    getToken: async () => encodeAddeparSecret({ apiKey: "k", apiSecret: "s" }),
    fetchImpl,
  };
}

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
const endpoint = (c: Call) => {
  const u = new URL(c.url);
  return `${u.origin}${u.pathname}`;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("addepar client — address", () => {
  it.each([
    ["https://examplefirm.addepar.com"],
    ["https://examplefirm.addepar.com/"],
    ["https://examplefirm.addepar.com/api"],
    ["https://examplefirm.addepar.com/api/"],
    ["https://examplefirm.addepar.com/api/v1"],
  ])("reaches a firm's own host under /api (typed as %s)", async (apiBase) => {
    const { fetchImpl, calls } = fakeFetch(json(GROUPS_CHILD_GROUPS));

    await addeparClient.getHouseholds(ctxWith(fetchImpl, apiBase));

    expect(endpoint(calls[0])).toBe("https://examplefirm.addepar.com/api/v1/groups");
  });

  it("reaches api.addepar.com at its root — the docs' URLs page lists it with no /api part", async () => {
    const { fetchImpl, calls } = fakeFetch(json(GROUPS_CHILD_GROUPS));

    await addeparClient.getHouseholds(ctxWith(fetchImpl, "https://api.addepar.com/"));

    expect(endpoint(calls[0])).toBe("https://api.addepar.com/v1/groups");
  });
});

describe("addepar client — headers", () => {
  it("sends Basic auth and the Addepar-Firm header on a GET", async () => {
    const { fetchImpl, calls } = fakeFetch(json(GROUPS_CHILD_GROUPS));

    await addeparClient.getHouseholds(ctxWith(fetchImpl));

    expect(header(calls[0], "authorization")).toBe(`Basic ${Buffer.from("k:s").toString("base64")}`);
    expect(header(calls[0], "addepar-firm")).toBe("42");
  });

  it("sends the Addepar-Firm header and the JSON:API content type on the portfolio query POST", async () => {
    const { fetchImpl, calls } = fakeFetch(json(PORTFOLIO_QUERY_ACCOUNT_WITH_POSITIONS));

    await addeparClient.getAccounts(ctxWith(fetchImpl), "9559");

    expect(calls[0].init.method).toBe("POST");
    expect(header(calls[0], "addepar-firm")).toBe("42");
    expect(header(calls[0], "content-type")).toBe("application/vnd.api+json");
  });
});

describe("addepar client — households (groups)", () => {
  it("maps each group to a household and follows links.next under the API root", async () => {
    const { fetchImpl, calls } = fakeFetch(
      json({ ...GROUPS_GET_ALL, links: { next: PAGINATION_NEXT } }),
      json(GROUPS_CHILD_GROUPS),
    );

    const households = await addeparClient.getHouseholds(ctxWith(fetchImpl));

    expect(households).toEqual([
      { id: "100", name: "Group 1" },
      { id: "101", name: "Group 2" },
      { id: "92", name: "Child Group" },
    ]);
    expect(calls).toHaveLength(2);
    const second = new URL(calls[1].url);
    expect(`${second.origin}${second.pathname}`).toBe("https://examplefirm.addepar.com/api/v1/groups");
    expect(second.searchParams.get("page[after]")).toBe("101");
  });

  it("refuses a links.next that points off the firm's Addepar host", async () => {
    const { fetchImpl, calls } = fakeFetch(
      json({ ...GROUPS_GET_ALL, links: { next: "https://evil.example/v1/groups?page[after]=101" } }),
    );

    await expect(addeparClient.getHouseholds(ctxWith(fetchImpl, "https://api.addepar.com"))).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

describe("addepar client — errors", () => {
  it("fails on the first 401 with a credentials error the admin can act on — no retry", async () => {
    const { fetchImpl, calls } = fakeFetch(json({}, 401), json(GROUPS_CHILD_GROUPS));

    const err = await addeparClient.getHouseholds(ctxWith(fetchImpl)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CredentialsRejected);
    expect((err as Error).message).toMatch(/API key/);
    expect((err as Error).message).toMatch(/secret/);
    expect(calls).toHaveLength(1);
  });

  it("fails on a 429 without waiting out Addepar's 15-minute window", async () => {
    const { fetchImpl, calls } = fakeFetch(json({}, 429, { "X-RateLimit-Retry-After": "840" }));

    await expect(addeparClient.getHouseholds(ctxWith(fetchImpl))).rejects.toThrow(/14 min/);
    expect(calls).toHaveLength(1);
  });

  it("doesn't re-send a household's query after a 5xx — each try spends the firm's request budget", async () => {
    const { fetchImpl, calls } = fakeFetch(json({}, 500), json(PORTFOLIO_QUERY_ACCOUNT_WITH_POSITIONS));

    await expect(addeparClient.getAccounts(ctxWith(fetchImpl), "9559")).rejects.toThrow(/500/);
    expect(calls).toHaveLength(1);
  });

  it("carries Addepar's error detail — the FAQ's 60-second timeout 400 — into the thrown error", async () => {
    const { fetchImpl } = fakeFetch(
      json({ errors: [{ status: "400", title: "Bad Request", detail: "API request timeout exceeded." }] }, 400),
    );

    await expect(addeparClient.getAccounts(ctxWith(fetchImpl), "9559")).rejects.toThrow(
      /API request timeout exceeded/,
    );
  });
});

describe("addepar client — accounts and holdings (Portfolio Query)", () => {
  it("asks for one household's accounts and positions in a single GROUP query as of yesterday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    const { fetchImpl, calls } = fakeFetch(json(PORTFOLIO_QUERY_ACCOUNT_WITH_POSITIONS));

    await addeparClient.getAccounts(ctxWith(fetchImpl), "9559");

    expect(endpoint(calls[0])).toBe("https://examplefirm.addepar.com/api/v1/portfolio/query");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      data: {
        type: "portfolio_query",
        attributes: {
          columns: [{ key: "value" }, { key: "cost_basis" }],
          groupings: [{ key: "holding_account" }, { key: "position" }],
          portfolio_type: "GROUP",
          portfolio_id: 9559,
          start_date: "2026-10-20",
          end_date: "2026-10-20",
          hide_previous_holdings: true,
        },
      },
    });
  });

  it("maps each holding account to an account and its positions to holdings, from that one reply", async () => {
    const { fetchImpl, calls } = fakeFetch(json(PORTFOLIO_QUERY_ACCOUNT_WITH_POSITIONS));
    const ctx = ctxWith(fetchImpl);

    const accounts = await addeparClient.getAccounts(ctx, "9559");
    const positions = await addeparClient.getPositions(ctx, "2260636");

    expect(accounts).toEqual([
      {
        id: "2260636",
        name: "Adam Smith IRA (786581)",
        registrationType: "Adam Smith IRA (786581)",
        value: 10375354.56,
        costBasis: 9000000,
      },
    ]);
    expect(positions).toEqual([
      { description: "Anchorage Illiquid Opportunities III Access Fund LP", marketValue: 1746188, costBasis: 1500000 },
      { description: "GS Liquidity Partners 2007 LP", marketValue: 8629166.56, costBasis: 7500000 },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("takes a nested account's figures out of its parent so the household isn't counted twice", async () => {
    const { fetchImpl } = fakeFetch(json(PORTFOLIO_QUERY_COST_BASIS_BY_ACCOUNT));

    const accounts = await addeparClient.getAccounts(ctxWith(fetchImpl), "9559");

    expect(accounts.map((a) => [a.id, a.name])).toEqual([
      ["2260636", "Adam Smith IRA (786581)"],
      ["2260640", "Pershing (DMA 859658)"],
      ["259885", "Manager A"],
      ["259825", "DJIA ETF 90"],
      ["260654", "Manager C"],
      ["259875", "Manager I"],
      ["260737", "Manager K"],
      ["260740", "Manager M"],
      ["2260638", "Southern Trust Fixed Income SMA (600551984)"],
    ]);
    const basis = Object.fromEntries(accounts.map((a) => [a.id, a.costBasis]));
    // Parent minus child = the parent's own "Directly Owned" row in the docs' reply.
    expect(basis["2260636"]).toBeCloseTo(565000, 2);
    expect(basis["2260640"]).toBe(690000);
    expect(basis["259885"]).toBeCloseTo(4148217.034662644, 2);
    // The docs' reply sums to its Total once each account is counted once.
    const sum = accounts.reduce((s, a) => s + (a.costBasis ?? 0), 0);
    expect(sum).toBeCloseTo(2.1105883993468016e7, 2);
    // No value column was asked for in that reply.
    expect(accounts.every((a) => a.value === null)).toBe(true);
  });

  it("skips positions the household holds directly, outside any account", async () => {
    const { fetchImpl } = fakeFetch(json(PORTFOLIO_VIEW_DIRECTLY_OWNED));

    expect(await addeparClient.getAccounts(ctxWith(fetchImpl), "9559")).toEqual([]);
  });

  it("refuses holdings for an account its household query never returned, without calling Addepar", async () => {
    const { fetchImpl, calls } = fakeFetch();

    await expect(addeparClient.getPositions(ctxWith(fetchImpl), "2260636")).rejects.toThrow(/getAccounts/);
    expect(calls).toHaveLength(0);
  });
});

describe("testAddeparConnection", () => {
  it("makes one one-row read and never pages on", async () => {
    const { fetchImpl, calls } = fakeFetch(json({ ...GROUPS_GET_ALL, links: { next: PAGINATION_NEXT } }));

    await testAddeparConnection(ctxWith(fetchImpl));

    expect(calls).toHaveLength(1);
    expect(endpoint(calls[0])).toBe("https://examplefirm.addepar.com/api/v1/groups");
    expect(new URL(calls[0].url).searchParams.get("page[limit]")).toBe("1");
  });
});
