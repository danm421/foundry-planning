// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientRowActions } from "../client-row-actions";

/**
 * The RESTING classes of a quick link, as exact tokens.
 *
 * Split, never substring-match: `"...hover:bg-accent..."` contains the string
 * `bg-accent`, so a naive `toContain` reports the grey secondary as carrying
 * the accent fill. Dropping the `hover:` / `focus-visible:` variants is also
 * the point — what these tests pin is the state you see without a pointer on
 * the row, which is exactly the state that kept reading as text.
 */
function restingClasses(name: string): string[] {
  return screen
    .getByRole("link", { name })
    .className.split(/\s+/)
    .filter((c) => c && !c.includes(":"));
}

describe("ClientRowActions", () => {
  // The reported defect was a CLASS STRING, which the href tests below cannot
  // see, so pin the treatment itself.
  //
  // `border-transparent` is the original regression — quick links that vanished
  // into the row — and that guard stays forever. The fills are the current fix:
  // two passes carried the affordance on a border alone and both still read as
  // text. `client-row-actions.tsx` records why a third would have too.
  it("gives each quick link an opaque fill, never a transparent border", () => {
    render(<ClientRowActions householdId="H1" planningClientId="C1" />);

    const [crm, planning] = ["CRM", "Planning"].map(restingClasses);

    for (const cls of [crm, planning]) {
      expect(cls).not.toContain("border-transparent");
      // The old border-only treatment, in case anyone reaches for it again.
      expect(cls).not.toContain("bg-card-2");
    }

    // CRM is the filled GREY button; Planning is the filled VERDIGRIS one.
    expect(crm).toContain("bg-control");
    expect(planning).toContain("bg-action");

    // Both labels are near-white PER THEME, which is what `*-on` means. A
    // hardcoded `text-white` is the failure mode to guard: the industrial
    // theme's accent is a pale olive, where white measures 1.43:1.
    expect(planning).toContain("text-action-on");
    for (const cls of [crm, planning]) {
      expect(cls).not.toContain("text-white");
    }
  });

  // Hierarchy, not just weight: the accent is reserved for action, and a row
  // has exactly one primary verb. If CRM ever picks up the accent fill too,
  // the column becomes two CTAs per row and the hierarchy is gone.
  it("spends the accent on the planning action only", () => {
    render(<ClientRowActions householdId="H1" planningClientId="C1" />);
    expect(restingClasses("CRM")).not.toContain("bg-action");
  });

  // Its own test, not a second `render` in the one above: two mounted trees
  // share a screen, so any later "CRM" lookup would match twice and throw.
  it("keeps that hierarchy in the no-plan state", () => {
    render(<ClientRowActions householdId="H2" planningClientId={null} />);
    expect(restingClasses("Start planning")).toContain("bg-action");
    expect(restingClasses("CRM")).not.toContain("bg-action");
  });

  // Keyboard reachability — these are links in a dense table and the ring is
  // the only thing that says where focus landed.
  it("keeps a focus ring on both quick links", () => {
    render(<ClientRowActions householdId="H1" planningClientId="C1" />);

    for (const name of ["CRM", "Planning"]) {
      expect(screen.getByRole("link", { name }).className).toContain("focus-visible:ring-2");
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
