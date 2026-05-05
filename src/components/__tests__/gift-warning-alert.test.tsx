// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GiftWarningAlert } from "../gift-warning-alert";

describe("GiftWarningAlert", () => {
  it("renders nothing when there are no breaches", () => {
    const { container } = render(
      <GiftWarningAlert mode="inline" breaches={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders inline alert with grantor first name + overage + estimated tax", () => {
    render(
      <GiftWarningAlert
        mode="inline"
        breaches={[
          { grantorFirstName: "Cooper", overage: 250_000, estimatedTax: 100_000 },
        ]}
      />,
    );
    expect(screen.getByText(/Cooper/)).toBeInTheDocument();
    expect(screen.getByText(/\$250,000/)).toBeInTheDocument();
    expect(screen.getByText(/\$100,000/)).toBeInTheDocument();
  });

  it("renders banner mode with red styling and 'lifetime exemption' wording", () => {
    const { container } = render(
      <GiftWarningAlert
        mode="banner"
        breaches={[
          { grantorFirstName: "Cooper", overage: 1_000_000, estimatedTax: 400_000, firstYear: 2032 },
        ]}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toMatch(/text-red-|bg-red-|text-crit/);
    expect(screen.getByText(/exceed lifetime exemption/i)).toBeInTheDocument();
    expect(screen.getByText(/2032/)).toBeInTheDocument();
  });

  it("renders one row per breaching grantor in banner mode", () => {
    render(
      <GiftWarningAlert
        mode="banner"
        breaches={[
          { grantorFirstName: "Cooper", overage: 500_000, estimatedTax: 200_000, firstYear: 2032 },
          { grantorFirstName: "Susan",  overage: 250_000, estimatedTax: 100_000, firstYear: 2034 },
        ]}
      />,
    );
    expect(screen.getByText(/Cooper/)).toBeInTheDocument();
    expect(screen.getByText(/Susan/)).toBeInTheDocument();
    expect(screen.getByText(/2032/)).toBeInTheDocument();
    expect(screen.getByText(/2034/)).toBeInTheDocument();
  });
});
