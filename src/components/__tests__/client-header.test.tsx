// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import ClientHeader from "../client-header";
import { CLIENT_HEADER_ACTIONS_ID } from "../client-header-actions";
import type { PersonInfo } from "../client-identity-menu";

const people: PersonInfo[] = [
  {
    role: "primary",
    firstName: "Cooper",
    lastName: "Sample",
    dateOfBirth: "1971-03-12",
    email: "cooper@example.com",
    phone: null,
    mobile: null,
  },
];

describe("ClientHeader", () => {
  it("renders an always-compact sticky bar (no tall state)", () => {
    const { container } = render(<ClientHeader clientId="abc" people={people} />);
    const bar = container.firstChild as HTMLElement;
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("h-[44px]");
    expect(bar.className).not.toContain("h-[100px]");
  });

  it("stacks above the report subtab bars so its dropdown isn't overlapped", () => {
    // Report subtab bars (assets/cashflow/estate-planning) are sticky `z-30`
    // and live later in the DOM, so a `z-30` header loses the stacking tie and
    // its dropdown gets painted over. The header must sit above `z-30` (and
    // below the topbar's `z-40`, whose hover menus open into the header row).
    const { container } = render(<ClientHeader clientId="abc" people={people} />);
    const bar = container.firstChild as HTMLElement;
    expect(bar.className).not.toContain("z-30");
    expect(bar.className).toContain("z-[35]");
  });

  it("renders the identity trigger, the center slot, and the right slot", () => {
    render(
      <ClientHeader
        clientId="abc"
        people={people}
        centerSlot={<span>sub-report-tabs</span>}
        rightSlot={<span>chips-here</span>}
      />,
    );
    expect(screen.getByText("Cooper Sample")).toBeInTheDocument();
    expect(screen.getByText("sub-report-tabs")).toBeInTheDocument();
    expect(screen.getByText("chips-here")).toBeInTheDocument();
  });

  it("puts route actions BEFORE the plan chrome, with the divider on the actions slot", () => {
    // The plan selector + CRM link stay pinned to the right edge on every
    // route; a page's portaled actions (solver's Reset / Save…) land to their
    // left. Asserting the DOM order — not just presence — is the only way this
    // reads, since both are siblings in the same flex row.
    const { container } = render(
      <ClientHeader clientId="abc" people={people} rightSlot={<span>chips-here</span>} />,
    );

    const slot = container.querySelector(`#${CLIENT_HEADER_ACTIONS_ID}`)!;
    const chips = screen.getByText("chips-here");
    expect(slot.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The divider must collapse with the slot when a route contributes nothing,
    // so it has to be the slot's own border — a border-l on the chrome would
    // leave a stray rule on every other route.
    expect(slot.className).toContain("border-r");
    expect(slot.className).toContain("empty:hidden");
  });
});
