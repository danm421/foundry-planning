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
  // What it must never do is grow its own treatment: the reported defect was
  // one table's name behaving differently from the other's. The exact-equality
  // assertion is the guard, and it holds whatever `RECORD_NAME_LINK` becomes.
  it("gives the shared client's name the same link affordance as the main list", () => {
    render(<SharedWithMeTable rows={ROWS} />);
    const link = screen.getByRole("link", { name: "Ada Lovelace" });
    expect(link.className).toBe(RECORD_NAME_LINK);
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
