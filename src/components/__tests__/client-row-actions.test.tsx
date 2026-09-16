// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientRowActions } from "../client-row-actions";

describe("ClientRowActions", () => {
  // The reported defect was a CLASS STRING: `border-transparent` on a dark fill
  // over a dark row, which advisors read as "nothing here is clickable". The
  // href tests below cannot see that, so pin the border itself.
  it("gives each quick link a visible border, not a transparent one", () => {
    render(<ClientRowActions householdId="H1" planningClientId="C1" />);

    for (const name of ["CRM", "Planning"]) {
      const cls = screen.getByRole("link", { name }).className;
      expect(cls).toContain("border-hair-2");
      expect(cls).not.toContain("border-transparent");
    }
  });

  it("links CRM + Planning when a plan exists", () => {
    render(<ClientRowActions householdId="H1" planningClientId="C1" />);

    expect(screen.getByRole("link", { name: "CRM" })).toHaveAttribute(
      "href",
      "/crm/households/H1",
    );
    expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute(
      "href",
      "/clients/C1/details",
    );
    expect(screen.queryByRole("link", { name: "Start planning" })).toBeNull();
  });

  it("links CRM + Start planning when no plan exists", () => {
    render(<ClientRowActions householdId="H2" planningClientId={null} />);

    expect(screen.getByRole("link", { name: "CRM" })).toHaveAttribute(
      "href",
      "/crm/households/H2",
    );
    expect(screen.getByRole("link", { name: "Start planning" })).toHaveAttribute(
      "href",
      "/clients/new?crmHouseholdId=H2",
    );
    expect(screen.queryByRole("link", { name: "Planning" })).toBeNull();
  });
});
