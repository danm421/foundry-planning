// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SharedWithMeTable } from "../shared-with-me-table";
import { RECORD_NAME_LINK, ROW_HOVER } from "../../table-styles";

const ROWS = [
  {
    clientId: "C1",
    displayName: "Ada Lovelace",
    ownerName: "Dana Advisor",
    firmName: "Ethos Financial Group",
    permission: "view" as const,
  },
];

describe("SharedWithMeTable", () => {
  // This table renders a client's name on the SAME screen as the clients list.
  // It carried the exact defect an advisor reported — a hover-only underline —
  // so it must not drift back to its own treatment.
  it("gives the shared client's name the same standing link affordance", () => {
    render(<SharedWithMeTable rows={ROWS} />);
    const link = screen.getByRole("link", { name: "Ada Lovelace" });
    expect(link.className).toBe(RECORD_NAME_LINK);
    expect(link.className).not.toMatch(/(^|\s)hover:underline(\s|$)/);
  });

  // Both of this row's badges are filled `card-2`, so a row that hovers to
  // `card-2` erases them.
  it("hovers the row to card-hover, not to its badges' own fill", () => {
    render(<SharedWithMeTable rows={ROWS} />);
    const row = screen.getByRole("link", { name: "Ada Lovelace" }).closest("tr")!;
    expect(row.className).toBe(ROW_HOVER);
    expect(row.className).not.toContain("hover:bg-card-2");
  });
});
