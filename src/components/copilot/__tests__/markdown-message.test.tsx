// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownMessage } from "../markdown-message";

describe("MarkdownMessage", () => {
  it("renders bold, list, link, inline code and a GFM table to text", () => {
    const md = [
      "**Probability of success** is 84%.",
      "",
      "- Base case",
      "- Roth scenario",
      "",
      "See the [report](https://example.test).",
      "",
      "Run `run_monte_carlo` to refresh.",
      "",
      "| Scenario | PoS |",
      "| --- | --- |",
      "| Base | 80% |",
    ].join("\n");

    render(<MarkdownMessage text={md} />);

    expect(screen.getByText("Probability of success")).toBeInTheDocument();
    expect(screen.getByText("Base case")).toBeInTheDocument();
    expect(screen.getByText("Roth scenario")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "report" });
    expect(link).toHaveAttribute("href", "https://example.test");
    expect(screen.getByText("run_monte_carlo")).toBeInTheDocument();
    // GFM table cells
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("PoS")).toBeInTheDocument();
  });
});
