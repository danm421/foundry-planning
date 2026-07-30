// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiRow } from "../kpi-row";
import type { BookKpis } from "@/lib/home/types";

const KPIS: BookKpis = {
  totalBookValue: 1_250_000,
  assetsHeldAway: 4_210_000,
  heldAwayAccounts: 12,
  activeHouseholds: 1,
  prospectHouseholds: 4,
  planningClients: 5,
  tasksDueThisWeek: 4,
  tasksDueThisWeekMine: 4,
};

describe("KpiRow", () => {
  it("renders both money tiles with their values", () => {
    render(<KpiRow kpis={KPIS} />);
    expect(screen.getByText("Total book value")).toBeInTheDocument();
    expect(screen.getByText("Assets held away")).toBeInTheDocument();
    expect(screen.getByText("$1,250,000")).toBeInTheDocument();
    expect(screen.getByText("$4,210,000")).toBeInTheDocument();
  });

  it("subtitles held-away with its account count", () => {
    render(<KpiRow kpis={KPIS} />);
    expect(screen.getByText("across 12 accounts")).toBeInTheDocument();
  });

  it("singularises a one-account held-away subtitle", () => {
    render(<KpiRow kpis={{ ...KPIS, heldAwayAccounts: 1 }} />);
    expect(screen.getByText("across 1 account")).toBeInTheDocument();
  });

  it("subtitles planning clients with the household base it is drawn from", () => {
    // The Households tile leads with `active` only, so a planning-client count
    // that spans active + prospects reads as impossible next to it (13 clients,
    // "5 households"). The sub names the real denominator.
    render(<KpiRow kpis={{ ...KPIS, activeHouseholds: 5, prospectHouseholds: 9, planningClients: 13 }} />);
    // Assert PLACEMENT, not just presence — a sub on the wrong tile still
    // satisfies getByText, and position has no naturally-failing value.
    const tile = screen.getByText("Planning clients").closest("section");
    expect(tile).toHaveTextContent("13");
    expect(tile).toHaveTextContent("of 14 households");
    // ...and the Households tile keeps its own, different sub.
    expect(screen.getByText("Households").closest("section")).toHaveTextContent(
      "+9 prospects",
    );
  });

  it("singularises a one-household planning-client subtitle", () => {
    render(<KpiRow kpis={{ ...KPIS, activeHouseholds: 1, prospectHouseholds: 0, planningClients: 1 }} />);
    expect(screen.getByText("of 1 household")).toBeInTheDocument();
  });

  it("renders five tiles", () => {
    const { container } = render(<KpiRow kpis={KPIS} />);
    expect(container.querySelectorAll("section")).toHaveLength(5);
  });

  it("degrades to em-dashes when kpis is null, keeping every label", () => {
    render(<KpiRow kpis={null} />);
    expect(screen.getByText("Total book value")).toBeInTheDocument();
    expect(screen.getByText("Assets held away")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(5);
  });

  it("links each money tile to its focused breakdown", () => {
    render(<KpiRow kpis={KPIS} />);
    const book = screen.getByRole("link", { name: /Total book value/i });
    const held = screen.getByRole("link", { name: /Assets held away/i });
    expect(book).toHaveAttribute("href", "/home/book?focus=book");
    expect(held).toHaveAttribute("href", "/home/book?focus=held-away");
  });

  it("does not link the money tiles when kpis is null", () => {
    render(<KpiRow kpis={null} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
