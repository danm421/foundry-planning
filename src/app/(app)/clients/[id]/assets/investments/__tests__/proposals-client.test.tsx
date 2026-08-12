// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProposalSnapshot } from "@/lib/investments/proposals/types";
import frozenSnapshot from "@/lib/investments/proposals/__tests__/fixtures/snapshot-v1.json";
import { ProposalsClient } from "../proposals-client";

// Chart.js needs a real 2D canvas context, which jsdom does not provide. Only
// the scatter is stubbed — every control and figure these tests assert on is the
// real component.
vi.mock("../rebalance-risk-return-scatter", () => ({
  RebalanceRiskReturnScatter: () => <div data-testid="scatter" />,
}));

const ACCOUNTS = [{ id: "acc-1", name: "Joint Brokerage", category: "taxable", value: 500_000 }];
const PORTFOLIOS = [
  { id: "tp-1", name: "Core Moderate" },
  { id: "tp-2", name: "Core Aggressive" },
];

/** A fee carrying more precision than `advisory_fee_current` can hold. The column
 *  is `numeric(6,5)`, so it keeps `COLUMN_FEE`; the frozen jsonb snapshot keeps
 *  the number the API was handed. The screen seeds its input from the column and
 *  compares against the snapshot, so the two must render as the same fee — else
 *  a screen nobody touched reports an edit, and saving advances the as-of date. */
const SENT_FEE = 0.012346;
const COLUMN_FEE = 0.01235;

/** One unit down on the last digit the input can display, which is also the last
 *  the column can hold: the smallest real edit. */
const MINIMAL_EDIT = "1.234";

/** The frozen v1 artifact with only the two fee fields overridden, so the shape
 *  under test is the genuine snapshot rather than a hand-written stand-in. */
const snapshot = {
  ...(frozenSnapshot as unknown as ProposalSnapshot),
  fees: {
    ...(frozenSnapshot as unknown as ProposalSnapshot).fees,
    advisoryFeeCurrent: SENT_FEE,
    advisoryFeeProposed: 0.005,
  },
} satisfies ProposalSnapshot;

const storedRow = {
  id: "p1",
  name: "Move to Core Moderate",
  status: "draft" as const,
  source: { accountIds: ["acc-1"] },
  target: { portfolioId: "tp-1" },
  targetLabel: "Core Moderate",
  advisoryFeeCurrent: COLUMN_FEE,
  advisoryFeeProposed: 0.005,
  overrideLtcgRate: null,
  result: snapshot,
  computedAt: "2026-03-04T00:00:00.000Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Answers the list GET and records every other call so a stray write shows up. */
function mockApi(listResponse: () => Response) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "GET") return listResponse();
      return json({ id: "p1", result: snapshot, computedAt: "2026-03-05T00:00:00.000Z" });
    }),
  );
  return calls;
}

const subject = () => (
  <ProposalsClient clientId="client-1" accountsWithHoldings={ACCOUNTS} fundPortfolios={PORTFOLIOS} />
);

async function openTheSavedProposal() {
  render(subject());
  // A string `name` matches the full accessible name, so this picks the row-name
  // button and not the "Duplicate/Delete Move to Core Moderate" actions.
  await userEvent.click(await screen.findByRole("button", { name: "Move to Core Moderate" }));
  // The stored as-of stamp only renders once the snapshot is open, so waiting on
  // it proves the comparison is up — not just that the builder mounted.
  await screen.findByText(/Mar 4, 2026/);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("ProposalsClient", () => {
  it("does not report a fee only the fee column rounded as edited", async () => {
    mockApi(() => json({ proposals: [storedRow] }));
    await openTheSavedProposal();

    // The seeded input is what the advisor sees; it must not be read as an edit.
    // Displaying a decimal the column cannot hold makes the seeded input and the
    // frozen snapshot disagree, which is the whole defect.
    expect((screen.getByLabelText("Current advisory fee") as HTMLInputElement).value).toBe("1.235");
    expect(screen.queryByText(/The advisory fee changed/)).not.toBeInTheDocument();
  });

  it("saves a reopened proposal without recomputing when nothing was edited", async () => {
    const calls = mockApi(() => json({ proposals: [storedRow] }));
    await openTheSavedProposal();
    await userEvent.click(screen.getByRole("button", { name: "Save & close" }));
    await screen.findByText(/Saved proposals for this client/);

    // A no-op save must not advance the as-of date, so nothing may recompute.
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("saves the smallest edit the fee input can express", async () => {
    const calls = mockApi(() => json({ proposals: [storedRow] }));
    await openTheSavedProposal();

    const field = screen.getByLabelText("Current advisory fee");
    expect((field as HTMLInputElement).value).toBe("1.235");
    await userEvent.clear(field);
    await userEvent.type(field, MINIMAL_EDIT);

    // The advisor changed the fee, so the screen must offer to apply it…
    expect(screen.getByText(/The advisory fee changed/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save & close" }));
    await screen.findByText(/Saved proposals for this client/);

    // …and saving must carry it, recomputing so the fee section and break-even
    // stop describing the old rate.
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    const body = puts[0].body as { advisoryFeeCurrent: number; recompute: boolean };
    expect(body.recompute).toBe(true);
    // Precision 9 discriminates the edit (0.01234) from the stored 0.01235, and
    // the sent value must be one the fee column can hold exactly.
    expect(body.advisoryFeeCurrent).toBeCloseTo(0.01234, 9);
    expect(body.advisoryFeeCurrent).toBe(Number(body.advisoryFeeCurrent.toFixed(5)));
  });

  it("will not save a target the stored proposal was never computed from", async () => {
    const calls = mockApi(() => json({ proposals: [storedRow] }));
    await openTheSavedProposal();

    // Switch the target portfolio without recomputing. `save()` only ever sends
    // name and fees, so a plain Save would recompute from the STORED target and
    // stamp a fresh as-of date on numbers the new one never produced.
    await userEvent.selectOptions(screen.getByRole("combobox"), "tp-2");

    expect(screen.getByText(/Recompute to apply/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save & close" })).toBeDisabled();
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("saves the switched target once Recompute has applied it", async () => {
    const calls = mockApi(() => json({ proposals: [storedRow] }));
    await openTheSavedProposal();
    await userEvent.selectOptions(screen.getByRole("combobox"), "tp-2");

    await userEvent.click(screen.getByRole("button", { name: "Recompute" }));
    await waitFor(() =>
      expect(screen.queryByText(/Recompute to apply/)).not.toBeInTheDocument(),
    );

    // The recompute carries the new target AND the label the list will show.
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toMatchObject({
      target: { portfolioId: "tp-2" },
      targetLabel: "Core Aggressive",
      recompute: true,
    });

    // …and Save & close is live again, with nothing left to send.
    const save = screen.getByRole("button", { name: "Save & close" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await screen.findByText(/Saved proposals for this client/);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("blocks Save & close on a fee the API would reject", async () => {
    mockApi(() => json({ proposals: [storedRow] }));
    await openTheSavedProposal();

    const save = screen.getByRole("button", { name: "Save & close" });
    expect(save).toBeEnabled();
    // The schema bound is 0.1 as a fraction, so 20% is out of range.
    await userEvent.clear(screen.getByLabelText("Current advisory fee"));
    await userEvent.type(screen.getByLabelText("Current advisory fee"), "20");
    expect(screen.getByText(/Enter a fee between 0 and 10%/)).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("does not open the builder on a target Compute cannot use", async () => {
    // First run for a firm with exactly ONE fund portfolio: no saved proposals,
    // so the empty state drops straight into the builder. A select displaying
    // that portfolio while the parent still holds no target leaves Compute dead
    // with no change event left to fire.
    mockApi(() => json({ proposals: [] }));
    render(
      <ProposalsClient
        clientId="client-1"
        accountsWithHoldings={ACCOUNTS}
        fundPortfolios={[PORTFOLIOS[0]]}
      />,
    );
    await screen.findByRole("button", { name: "Compute" });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("");

    await userEvent.click(screen.getByRole("checkbox", { name: /Joint Brokerage/ }));
    expect(screen.getByRole("button", { name: "Compute" })).toBeDisabled();

    // Picking the firm's only portfolio is what enables it.
    await userEvent.selectOptions(select, "tp-1");
    expect(screen.getByRole("button", { name: "Compute" })).toBeEnabled();
  });

  it("reports a failed list load as a failure, not as an empty client", async () => {
    mockApi(() => json({ error: "Not found" }, 404));
    render(subject());
    await waitFor(() => expect(screen.getByText("Not found")).toBeInTheDocument());
    expect(screen.queryByText(/No proposals yet/i)).not.toBeInTheDocument();
  });
});
