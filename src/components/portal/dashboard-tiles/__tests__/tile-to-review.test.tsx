// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TileToReview } from "@/components/portal/dashboard-tiles/tile-to-review";

const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({ usePortalFetch: () => portalFetchMock }));

const toReview = {
  count: 2,
  sample: [
    { id: "t1", date: "2026-06-20", name: "AMZN", merchantName: "Amazon", amount: 42, accountName: "Card" },
    { id: "t2", date: "2026-06-19", name: "SBUX", merchantName: "Starbucks", amount: 6, accountName: "Card" },
  ],
};

beforeEach(() => portalFetchMock.mockReset());

describe("TileToReview", () => {
  it("checks a transaction off: PUTs reviewed + removes the row + decrements count", async () => {
    portalFetchMock.mockResolvedValue({ ok: true });
    render(<TileToReview toReview={toReview} onOpen={() => {}} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Mark as reviewed")[0]);
    await waitFor(() => expect(screen.queryByText("Amazon")).not.toBeInTheDocument());
    expect(screen.getByText("1")).toBeInTheDocument();
    const [url, init] = portalFetchMock.mock.calls[0];
    expect(url).toBe("/api/portal/transactions/t1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ reviewed: true });
  });

  it("reverts the row when the PUT fails", async () => {
    portalFetchMock.mockResolvedValue({ ok: false });
    render(<TileToReview toReview={toReview} onOpen={() => {}} />);
    fireEvent.click(screen.getAllByLabelText("Mark as reviewed")[0]);
    await waitFor(() => expect(screen.getByText(/Couldn.t save/)).toBeInTheDocument());
    expect(screen.getByText("Amazon")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
