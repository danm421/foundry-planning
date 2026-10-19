// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { OverflowMenu } from "../overflow-menu";

describe("OverflowMenu", () => {
  it("the button trigger shows its label and opens a menu of links", () => {
    render(
      <OverflowMenu
        variant="button"
        triggerLabel="Portal"
        items={[
          { label: "Manage", href: "/clients/c1/portal" },
          { label: "Preview", href: "/clients/c1/portal/preview", newTab: true },
        ]}
      />,
    );

    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Portal" }));

    const manage = screen.getByRole("menuitem", { name: "Manage" });
    expect(manage).toHaveAttribute("href", "/clients/c1/portal");
    expect(manage).not.toHaveAttribute("target");

    const preview = screen.getByRole("menuitem", { name: "Preview" });
    expect(preview).toHaveAttribute("href", "/clients/c1/portal/preview");
    expect(preview).toHaveAttribute("target", "_blank");
    expect(preview).toHaveAttribute("rel", "noopener noreferrer");
  });
});
