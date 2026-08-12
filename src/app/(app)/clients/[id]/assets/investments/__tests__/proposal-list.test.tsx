// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalList } from "../proposal-list";

const rows = [
  {
    id: "p1",
    name: "Move to Core Moderate",
    targetLabel: "Core Moderate",
    status: "draft" as const,
    totalValue: 1_250_000,
    computedAt: "2026-03-04T00:00:00.000Z",
  },
];

describe("ProposalList", () => {
  it("shows the as-of date so a stale proposal is visible at a glance", () => {
    render(<ProposalList rows={rows} onOpen={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/Mar 4, 2026/)).toBeInTheDocument();
  });

  it("opens a proposal when its name is clicked", async () => {
    const onOpen = vi.fn();
    render(<ProposalList rows={rows} onOpen={onOpen} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Move to Core Moderate" }));
    expect(onOpen).toHaveBeenCalledWith("p1");
  });

  it("confirms before deleting", async () => {
    const onDelete = vi.fn();
    render(<ProposalList rows={rows} onOpen={vi.fn()} onDuplicate={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onDelete).toHaveBeenCalledWith("p1");
  });

  it("renders an empty state rather than a bare table", () => {
    render(<ProposalList rows={[]} onOpen={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no proposals yet/i)).toBeInTheDocument();
  });
});
