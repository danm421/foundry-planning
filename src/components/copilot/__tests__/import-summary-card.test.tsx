// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportSummaryCard } from "../import-summary-card";

const summary = { extract: { succeeded: 2, failed: 0 }, match: { exact: 3, fuzzy: 1, new: 1 } };

describe("ImportSummaryCard", () => {
  it("shows match breakdown and a Review link to the wizard", () => {
    render(
      <ImportSummaryCard clientId="client_1" importId="imp_1" summary={summary} warnings={[]} />,
    );
    expect(screen.getByText(/3 matched existing/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /review & commit/i });
    expect(link).toHaveAttribute("href", "/clients/client_1/details/import/imp_1");
  });

  it("renders warnings when present", () => {
    render(
      <ImportSummaryCard
        clientId="client_1"
        importId="imp_1"
        summary={{ extract: { succeeded: 1, failed: 1 }, match: { exact: 0, fuzzy: 0, new: 1 } }}
        warnings={["1 of 2 file(s) failed to extract."]}
      />,
    );
    expect(screen.getByText(/1 of 2 file\(s\) failed/i)).toBeInTheDocument();
  });
});
