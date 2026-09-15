// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal" }));

import PortalAddAccountMenu from "../portal-add-account-menu";
import PortalNav from "../portal-nav";

vi.mock("@clerk/nextjs", () => ({ UserButton: () => null }));

function openMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
}

describe("PortalAddAccountMenu", () => {
  it("stays closed until the trigger is clicked", () => {
    render(<PortalAddAccountMenu />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("sends each item to the Accounts page carrying its intent", () => {
    render(<PortalAddAccountMenu />);
    openMenu();
    const hrefs = screen
      .getAllByRole("menuitem")
      .map((el) => [el.textContent, el.getAttribute("href")]);
    // Two link items, not three: Plaid runs one flow for depository, credit
    // and loan accounts, so they share a label as well as an intent.
    expect(hrefs).toEqual([
      ["Link Bank, Card or Loan", "/portal/organizer/accounts?add=banking"],
      ["Link Investments", "/portal/organizer/accounts?add=investments"],
      ["Add Manually", "/portal/organizer/accounts?add=manual"],
    ]);
  });

  it("honors the advisor preview's basePath", () => {
    render(<PortalAddAccountMenu basePath="/clients/c1/portal/preview" />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Add Manually" })).toHaveAttribute(
      "href",
      "/clients/c1/portal/preview/organizer/accounts?add=manual",
    );
  });

  it("closes on Escape", () => {
    render(<PortalAddAccountMenu />);
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a click outside the menu", () => {
    render(
      <>
        <PortalAddAccountMenu />
        <button type="button">elsewhere</button>
      </>,
    );
    openMenu();
    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("PortalAddAccountMenu acting in place", () => {
  it("reports the picked intent instead of navigating", () => {
    const onSelect = vi.fn();
    render(<PortalAddAccountMenu onSelect={onSelect} />);
    openMenu();

    // No hrefs at all: on the Accounts page the flows are already here, so a
    // navigation would be a round trip to the page the client is standing on.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Link Investments" }));
    expect(onSelect).toHaveBeenCalledWith("investments");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("carries the same three intents the navigating binding does", () => {
    const onSelect = vi.fn();
    render(<PortalAddAccountMenu onSelect={onSelect} />);
    // Reopened between picks: choosing an item closes the menu, which is what
    // unmounts the other two.
    for (const label of ["Link Bank, Card or Loan", "Link Investments", "Add Manually"]) {
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
    }
    expect(onSelect.mock.calls.flat()).toEqual(["banking", "investments", "manual"]);
  });

  it("locks every item while a write is in flight", () => {
    const onSelect = vi.fn();
    render(<PortalAddAccountMenu onSelect={onSelect} disabled />);
    openMenu();
    for (const item of screen.getAllByRole("menuitem")) expect(item).toBeDisabled();
  });
});

describe("PortalNav add-account gate", () => {
  it("shows the menu above Dashboard when the client may edit", () => {
    render(<PortalNav editEnabled />);
    const trigger = screen.getByRole("button", { name: /Add Account/ });
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(trigger).toBeInTheDocument();
    expect(
      trigger.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the menu on a read-only portal", () => {
    render(<PortalNav editEnabled={false} />);
    expect(screen.queryByRole("button", { name: /Add Account/ })).not.toBeInTheDocument();
  });
});
