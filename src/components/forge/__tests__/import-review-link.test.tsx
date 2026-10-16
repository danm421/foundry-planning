// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportReviewLink } from "../import-review-link";

describe("ImportReviewLink", () => {
  it("links to the screen it is given — the Review Wizard for a classic attach", () => {
    render(<ImportReviewLink href="/clients/client_1/details/import/imp_1" warnings={[]} />);
    const link = screen.getByRole("link", { name: /review & apply/i });
    expect(link).toHaveAttribute("href", "/clients/client_1/details/import/imp_1");
  });

  it("links to the fact finder screen for a plan build", () => {
    render(<ImportReviewLink href="/clients/client_1/details/import/imp_1/fact-finder" warnings={[]} />);
    expect(screen.getByRole("link", { name: /review & apply/i })).toHaveAttribute(
      "href",
      "/clients/client_1/details/import/imp_1/fact-finder",
    );
  });

  it("renders non-fatal warnings when present", () => {
    render(
      <ImportReviewLink
        href="/clients/client_1/details/import/imp_1"
        warnings={["1 of 2 file(s) failed to extract."]}
      />,
    );
    expect(screen.getByText(/1 of 2 file\(s\) failed/i)).toBeInTheDocument();
  });
});
