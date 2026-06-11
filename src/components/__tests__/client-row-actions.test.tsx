// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientRowActions } from "../client-row-actions";

describe("ClientRowActions", () => {
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
