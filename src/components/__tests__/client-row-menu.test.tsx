// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClientRowMenu } from "../client-row-menu";

describe("ClientRowMenu", () => {
  it("shows Open CRM + Open planning when a plan exists", () => {
    render(
      <ClientRowMenu
        householdId="H1"
        name="Smith Household"
        hasPlanning
        planningClientId="C1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Smith Household" }));

    const crm = screen.getByRole("menuitem", { name: "Open CRM" });
    expect(crm).toHaveAttribute("href", "/crm/households/H1");
    const planning = screen.getByRole("menuitem", { name: "Open planning" });
    expect(planning).toHaveAttribute("href", "/clients/C1/overview");
    expect(screen.queryByRole("menuitem", { name: "Start planning" })).toBeNull();
  });

  it("shows Start planning when no plan exists", () => {
    render(
      <ClientRowMenu
        householdId="H2"
        name="Jones Household"
        hasPlanning={false}
        planningClientId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Jones Household" }));

    expect(screen.getByRole("menuitem", { name: "Open CRM" })).toHaveAttribute(
      "href",
      "/crm/households/H2",
    );
    const start = screen.getByRole("menuitem", { name: "Start planning" });
    expect(start).toHaveAttribute("href", "/clients/new?crmHouseholdId=H2");
    expect(screen.queryByRole("menuitem", { name: "Open planning" })).toBeNull();
  });

  it("is closed until the trigger is clicked", () => {
    render(
      <ClientRowMenu householdId="H3" name="Lee" hasPlanning={false} planningClientId={null} />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lee" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
