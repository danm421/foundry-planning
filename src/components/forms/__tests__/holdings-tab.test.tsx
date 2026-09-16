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

/** Captured bodies of the POST that creates a holding. */
let created: Record<string, unknown>[];
/** Every /quote URL requested — quotes are a paid call, so the count matters. */
let quoteCalls: string[];
let fetchMock: ReturnType<typeof vi.fn>;

/** Routes the four endpoints the tab talks to. `quote` decides what the price
 *  lookup returns, so a test can exercise the hit and the miss. */
function stubFetch(quote: { price: number; asOf: string } | { price: null }) {
  created = [];
  quoteCalls = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
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
