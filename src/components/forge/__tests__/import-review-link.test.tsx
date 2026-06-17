// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportReviewLink } from "../import-review-link";

describe("ImportReviewLink", () => {
  it("links to the review wizard for the import", () => {
    render(<ImportReviewLink clientId="client_1" importId="imp_1" warnings={[]} />);
    const link = screen.getByRole("link", { name: /review & apply/i });
    expect(link).toHaveAttribute("href", "/clients/client_1/details/import/imp_1");
  });

  it("renders non-fatal warnings when present", () => {
    render(
      <ImportReviewLink
        clientId="client_1"
        importId="imp_1"
        warnings={["1 of 2 file(s) failed to extract."]}
      />,
    );
    expect(screen.getByText(/1 of 2 file\(s\) failed/i)).toBeInTheDocument();
  });
});
