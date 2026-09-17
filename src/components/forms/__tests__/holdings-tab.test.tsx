// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HoldingsTab } from "../holdings-tab";

const PROPS = {
  clientId: "client-1",
  accountId: "acct-1",
  scenarioActive: false,
  assetClasses: [],
  deriveFromHoldings: true,
  onDeriveFromHoldingsChange: () => {},
  onTotalsChange: () => {},
};

/** What the ticker picker's search returns. */
const SEARCH_HITS = [
  {
    ticker: "VTSAX",
    name: "Vanguard Total Stock Market Index Fund Admiral Shares",
    exchange: "US",
    securityType: "mutual_fund",
  },
];

/** Captured bodies of the POST that creates a holding. */
let created: Record<string, unknown>[];
/** Every /quote URL requested — quotes are a paid call, so the count matters. */
let quoteCalls: string[];
/** Every /search URL requested — EODHD search is a paid call too. */
let searchCalls: string[];
let fetchMock: ReturnType<typeof vi.fn>;

/** Routes the four endpoints the tab talks to. `quote` decides what the price
 *  lookup returns, so a test can exercise the hit and the miss. */
function stubFetch(quote: { price: number; asOf: string } | { price: null }) {
  created = [];
  quoteCalls = [];
  searchCalls = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/search?")) { searchCalls.push(u); return { ok: true, json: async () => ({ results: SEARCH_HITS }) }; }
    if (u.includes("/quote")) { quoteCalls.push(u); return { ok: true, json: async () => quote }; }
    if (u.includes("/classify")) {
      return { ok: true, json: async () => ({ security: null, displayName: null, weights: [] }) };
    }
    if (init?.method === "POST") {
      created.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ id: "h-1" }) };
    }
    return { ok: true, json: async () => [] }; // GET list
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HoldingsTab add row", () => {
  it("prices a ticker that was never blurred, instead of saving it at $0", async () => {
    stubFetch({ price: 312.45, asOf: "2026-09-15" });
    render(<HoldingsTab {...PROPS} />);

    // Enter-to-add from the Shares box: the ticker field never blurs, which is
    // how a holding used to reach the server unpriced.
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "vti" } });
    fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "10" } });
    fireEvent.keyDown(screen.getByLabelText("Shares"), { key: "Enter" });

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ displayTicker: "VTI", shares: 10, price: 312.45 });
  });

  it("says so when the ticker can't be priced", async () => {
    stubFetch({ price: null });
    render(<HoldingsTab {...PROPS} />);

    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "PRVT1" } });
    fireEvent.blur(screen.getByLabelText("Ticker"));

    expect(await screen.findByText(/No market price found for PRVT1/)).toBeTruthy();
  });

  it("reports the as-of date when a price comes back", async () => {
    stubFetch({ price: 312.45, asOf: "2026-09-15" });
    render(<HoldingsTab {...PROPS} />);

    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "VTI" } });
    fireEvent.blur(screen.getByLabelText("Ticker"));

    expect(await screen.findByText(/market close for 2026-09-15/)).toBeTruthy();
    expect((screen.getByLabelText("Price") as HTMLInputElement).value).toBe("312.45");
  });

  it("buys one quote, not two, when a click on Add blurs the ticker first", async () => {
    stubFetch({ price: 312.45, asOf: "2026-09-15" });
    render(<HoldingsTab {...PROPS} />);

    // A mouse click on "+ Add" blurs the ticker field before the click lands,
    // so the blur lookup and the add lookup used to race as two paid calls.
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "VTI" } });
    fireEvent.blur(screen.getByLabelText("Ticker"));
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ price: 312.45 });
    expect(quoteCalls).toHaveLength(1);
  });

  it("drops the as-of line when the ticker is retyped", async () => {
    stubFetch({ price: 312.45, asOf: "2026-09-15" });
    render(<HoldingsTab {...PROPS} />);

    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "VTI" } });
    fireEvent.blur(screen.getByLabelText("Ticker"));
    await screen.findByText(/market close for 2026-09-15/);

    // The date belonged to VTI; leaving it under a different ticker misreports it.
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "VT" } });
    await waitFor(() => expect(screen.queryByText(/market close for/)).toBeNull());
  });

  it("leaves no ticker suggestion in the empty Ticker box", () => {
    stubFetch({ price: null });
    render(<HoldingsTab {...PROPS} />);
    // "VTI" used to sit here as a placeholder and read as a real holding.
    expect((screen.getByLabelText("Ticker") as HTMLInputElement).placeholder).toBe("");
  });
});

describe("HoldingsTab ticker picker", () => {
  /** A saved holding the advisor typed a NAME into and never had a ticker for —
   *  the row the search icon exists to repair. */
  const nameOnlyRow = {
    id: "h-9",
    accountId: "acct-1",
    securityId: null,
    displayTicker: null,
    displayName: "Vanguard Total Stock Market Index",
    shares: "100",
    price: "0",
    priceAsOf: null,
    costBasis: "5000",
    marketValue: null,
    sortOrder: 0,
    notes: null,
    securityWeights: [],
    overrides: [],
    needsReview: true,
  };

  /** Bodies of every PUT that patched a holding. */
  let updated: Record<string, unknown>[];

  function stubRowFetch(row: Record<string, unknown>) {
    updated = [];
    quoteCalls = [];
    searchCalls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/search?")) { searchCalls.push(u); return { ok: true, json: async () => ({ results: SEARCH_HITS }) }; }
      if (u.includes("/quote")) {
        quoteCalls.push(u);
        return { ok: true, json: async () => ({ price: 142.11, asOf: "2026-09-16" }) };
      }
      if (u.includes("/classify")) {
        return { ok: true, json: async () => ({ security: null, displayName: null, weights: [] }) };
      }
      if (init?.method === "PUT") {
        updated.push(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => [row] }; // GET list
    }));
  }

  it("fills the add row's Ticker box from a name search, and prices it", async () => {
    stubFetch({ price: 312.45, asOf: "2026-09-15" });
    render(<HoldingsTab {...PROPS} />);

    // The advisor has the fund's name and no symbol — so it goes in the only
    // box there is, and the magnifier next to it takes it from there.
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "vanguard total stock" } });
    fireEvent.click(screen.getByRole("button", { name: "Search for a security by name" }));

    const box = await screen.findByLabelText("Security name or ticker");
    expect((box as HTMLInputElement).value).toBe("vanguard total stock");

    fireEvent.click(await screen.findByRole("option", { name: /VTSAX/ }));

    await waitFor(() =>
      expect((screen.getByLabelText("Ticker") as HTMLInputElement).value).toBe("VTSAX"));
    await waitFor(() =>
      expect((screen.getByLabelText("Price") as HTMLInputElement).value).toBe("312.45"));

    // Reference data, not account data: the lookup must not be account-scoped,
    // or every other surface that wants it has to invent an account id.
    expect(searchCalls).toEqual([
      "/api/clients/client-1/holdings/search?q=vanguard%20total%20stock",
    ]);
  });

  it("attaches the ticker to a name-only row and prices it", async () => {
    stubRowFetch(nameOnlyRow);
    render(<HoldingsTab {...PROPS} />);

    fireEvent.click(await screen.findByRole("button", {
      name: /Search for a security by name to match Vanguard Total Stock Market Index/,
    }));

    // Seeded from the row's name, so there is nothing to retype.
    const box = await screen.findByLabelText("Security name or ticker");
    expect((box as HTMLInputElement).value).toBe("Vanguard Total Stock Market Index");

    fireEvent.click(await screen.findByRole("option", { name: /VTSAX/ }));

    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]).toMatchObject({
      displayTicker: "VTSAX",
      displayName: "Vanguard Total Stock Market Index Fund Admiral Shares",
      price: 142.11,
      priceAsOf: "2026-09-16",
    });
  });

  it("leaves an already-priced row's price alone", async () => {
    // Naming the ticker on a row whose price came off a statement must not
    // silently swap in today's close.
    stubRowFetch({ ...nameOnlyRow, price: "98.76" });
    render(<HoldingsTab {...PROPS} />);

    fireEvent.click(await screen.findByRole("button", { name: /Search for a security by name to match/ }));
    fireEvent.click(await screen.findByRole("option", { name: /VTSAX/ }));

    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]).toMatchObject({ displayTicker: "VTSAX" });
    expect(updated[0]).not.toHaveProperty("price");
    expect(quoteCalls).toEqual([]);
  });

  it("says the search is down rather than showing it as 'no matches'", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/search?")) {
        return { ok: false, status: 503, json: async () => ({ error: "Security search is unavailable right now." }) };
      }
      return { ok: true, json: async () => [] };
    }));
    render(<HoldingsTab {...PROPS} />);

    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "vanguard" } });
    fireEvent.click(screen.getByRole("button", { name: "Search for a security by name" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable right now/);
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });
});
