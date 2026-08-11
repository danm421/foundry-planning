// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { RebalanceSource, type RebalanceSourceValue } from "../rebalance-source";

const ACCOUNTS = [
  { id: "acct-1", name: "Joint Brokerage", category: "taxable", value: 500_000 },
  { id: "acct-2", name: "Rollover IRA", category: "retirement", value: 300_000 },
];

/** Drives the component the way the Rebalance tab does: value flows back in. */
function Harness({ onChange }: { onChange: (v: RebalanceSourceValue) => void }) {
  const [value, setValue] = useState<RebalanceSourceValue>({ kind: "accounts", accountIds: [] });
  return (
    <RebalanceSource
      clientId="client-1"
      accounts={ACCOUNTS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

const lastEmit = (onChange: ReturnType<typeof vi.fn>): RebalanceSourceValue =>
  onChange.mock.calls.at(-1)![0];

function mockExtract(accounts: unknown[], warnings: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ accounts, warnings }), { status: 200 })),
  );
}

async function switchToOutside(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Outside portfolio" }));
}

/** The statement upload input is visually hidden; reach it by type. */
const fileInputIn = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;

const statement = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46]) as BlobPart], "statement.pdf", {
    type: "application/pdf",
  });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RebalanceSource", () => {
  it("starts on client accounts and emits the ids that get checked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    expect(screen.getByText("Joint Brokerage")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Joint Brokerage/ }));

    expect(lastEmit(onChange)).toEqual({ kind: "accounts", accountIds: ["acct-1"] });
  });

  it("switching to an outside portfolio clears the account selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("checkbox", { name: /Joint Brokerage/ }));
    await switchToOutside(user);

    expect(lastEmit(onChange)).toMatchObject({ kind: "outside" });
    expect(screen.queryByText("Joint Brokerage")).not.toBeInTheDocument();
  });

  it("emits a typed holding with its shares and price", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await switchToOutside(user);

    await user.type(screen.getByLabelText("Ticker symbol"), "spy");
    await user.type(screen.getByLabelText("Shares"), "100");
    await user.type(screen.getByLabelText("Price"), "50");

    expect(lastEmit(onChange)).toEqual({
      kind: "outside",
      taxable: true,
      holdings: [{ ticker: "SPY", shares: 100, price: 50 }],
    });
  });

  it("totals the portfolio the same way the compute route prices it", async () => {
    const user = userEvent.setup();
    render(<Harness onChange={vi.fn()} />);
    await switchToOutside(user);

    // Row 1 states shares × price; row 2 states a value outright. Both count.
    await user.type(screen.getByLabelText("Ticker symbol"), "SPY");
    await user.type(screen.getByLabelText("Shares"), "100");
    await user.type(screen.getByLabelText("Price"), "50");
    await user.click(screen.getByRole("button", { name: "+ Add holding" }));
    await user.type(screen.getAllByLabelText("Ticker symbol")[1], "AGG");
    await user.type(screen.getAllByLabelText("Market value")[1], "20000");

    expect(screen.getByText("$25,000")).toBeInTheDocument();
  });

  it("never emits a row that names nothing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await switchToOutside(user);

    await user.type(screen.getByLabelText("Shares"), "100");

    expect(lastEmit(onChange)).toMatchObject({ holdings: [] });
  });

  it("adds and removes holding rows", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await switchToOutside(user);

    await user.type(screen.getByLabelText("Ticker symbol"), "SPY");
    await user.click(screen.getByRole("button", { name: "+ Add holding" }));
    expect(screen.getAllByLabelText("Ticker symbol")).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Remove holding" })[0]);
    expect(lastEmit(onChange)).toMatchObject({ holdings: [] });
  });

  it("carries the tax treatment onto the emitted portfolio", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await switchToOutside(user);

    await user.type(screen.getByLabelText("Ticker symbol"), "SPY");
    await user.click(screen.getByRole("button", { name: "Tax-deferred" }));

    expect(lastEmit(onChange)).toMatchObject({ taxable: false, holdings: [{ ticker: "SPY" }] });
  });

  it("warns that a taxable portfolio with no cost basis understates the tax", async () => {
    const user = userEvent.setup();
    render(<Harness onChange={vi.fn()} />);
    await switchToOutside(user);

    await user.type(screen.getByLabelText("Ticker symbol"), "SPY");
    await user.type(screen.getByLabelText("Market value"), "5000");
    expect(screen.getByText(/No cost basis on 1 of 1 holdings/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Cost basis"), "1200");
    expect(screen.queryByText(/No cost basis/i)).not.toBeInTheDocument();
  });

  it("does not warn about missing basis on a tax-deferred portfolio", async () => {
    const user = userEvent.setup();
    render(<Harness onChange={vi.fn()} />);
    await switchToOutside(user);

    await user.type(screen.getByLabelText("Ticker symbol"), "SPY");
    await user.type(screen.getByLabelText("Market value"), "5000");
    await user.click(screen.getByRole("button", { name: "Tax-deferred" }));

    expect(screen.queryByText(/No cost basis/i)).not.toBeInTheDocument();
  });

  it("loads a single extracted account straight into the table and adopts its tax character", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    mockExtract([
      {
        name: "Rollover IRA",
        taxable: false,
        holdings: [
          { ticker: "AGG", shares: 400, price: 50, marketValue: 20000 },
          { name: "Cash", marketValue: 5000 },
        ],
      },
    ]);
    const { container } = render(<Harness onChange={onChange} />);
    await switchToOutside(user);

    await user.upload(fileInputIn(container), statement());

    expect(lastEmit(onChange)).toEqual({
      kind: "outside",
      taxable: false,
      holdings: [
        { ticker: "AGG", shares: 400, price: 50, marketValue: 20000 },
        { name: "Cash", marketValue: 5000 },
      ],
    });
    expect(screen.getByText("Cash")).toBeInTheDocument();
  });

  it("makes the advisor pick when the statement holds several accounts", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    mockExtract([
      { name: "Joint Brokerage", taxable: true, holdings: [{ ticker: "SPY", marketValue: 100 }] },
      { name: "Rollover IRA", taxable: false, holdings: [{ ticker: "AGG", marketValue: 200 }] },
    ]);
    const { container } = render(<Harness onChange={onChange} />);
    await switchToOutside(user);

    await user.upload(fileInputIn(container), statement());

    // Nothing is loaded until a choice is made — the two differ in tax character,
    // which changes the tax estimate.
    expect(screen.getByText(/That statement holds 2 accounts/i)).toBeInTheDocument();
    expect(lastEmit(onChange)).toMatchObject({ holdings: [] });

    const iraRow = screen.getByText("Rollover IRA").closest("li")!;
    await user.click(within(iraRow).getByRole("button", { name: "Use these" }));

    expect(lastEmit(onChange)).toEqual({
      kind: "outside",
      taxable: false,
      holdings: [{ ticker: "AGG", marketValue: 200 }],
    });
    expect(screen.queryByText(/That statement holds/i)).not.toBeInTheDocument();
  });

  it("surfaces the server's message when the statement can't be read", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Unsupported file type." }), { status: 400 }),
      ),
    );
    const { container } = render(<Harness onChange={vi.fn()} />);
    await switchToOutside(user);

    await user.upload(fileInputIn(container), statement());

    expect(screen.getByText("Unsupported file type.")).toBeInTheDocument();
  });

  it("shows extraction warnings when nothing came back", async () => {
    const user = userEvent.setup();
    mockExtract([], ["No holdings could be read off this document."]);
    const { container } = render(<Harness onChange={vi.fn()} />);
    await switchToOutside(user);

    await user.upload(fileInputIn(container), statement());

    expect(
      screen.getByText("No holdings could be read off this document."),
    ).toBeInTheDocument();
  });
});
