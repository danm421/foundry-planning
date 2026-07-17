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
