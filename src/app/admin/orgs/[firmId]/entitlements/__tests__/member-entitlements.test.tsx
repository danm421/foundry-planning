// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MemberEntitlements, { type MemberEntitlementRow } from "../member-entitlements";

vi.mock("../actions", () => ({
  toggleEntitlementAction: vi.fn(),
  toggleUserEntitlementAction: vi.fn(),
}));

const cap = (over: Partial<MemberEntitlementRow["caps"][number]> = {}) => ({
  key: "client_portal",
  label: "Client portal",
  enabled: false,
  overrideMode: null,
  reason: null,
  setBy: null,
  createdAt: null,
  ...over,
});

const rows: MemberEntitlementRow[] = [
  { userId: "u_a", displayName: "Ada Advisor", email: "ada@firm.com", caps: [cap({ enabled: true })] },
  { userId: "u_b", displayName: "Bo Broker", email: "bo@firm.com", caps: [cap()] },
];

describe("MemberEntitlements", () => {
  it("lists every member with their effective state", () => {
    render(<MemberEntitlements firmId="org_firm" rows={rows} />);
    expect(screen.getByText("Ada Advisor")).toBeTruthy();
    expect(screen.getByText("Bo Broker")).toBeTruthy();
    expect(screen.getAllByText("Enabled")).toHaveLength(1);
    expect(screen.getAllByText("Disabled")).toHaveLength(1);
  });

  it("offers Revoke for an enabled member and Grant for a disabled one", () => {
    render(<MemberEntitlements firmId="org_firm" rows={rows} />);
    expect(screen.getByRole("button", { name: "Revoke Client portal for Ada Advisor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grant Client portal for Bo Broker" })).toBeTruthy();
  });

  it("names each control after the member it acts on", () => {
    // Every row renders the same words, so without the member's name a screen
    // reader hears N identical "Grant" buttons and N identical reason fields.
    render(<MemberEntitlements firmId="org_firm" rows={rows} />);
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .sort();
    expect(names).toEqual([
      "Grant Client portal for Bo Broker",
      "Revoke Client portal for Ada Advisor",
    ]);
    expect(screen.getByLabelText("Reason to grant Client portal for Bo Broker")).toBeTruthy();
    expect(screen.getByLabelText("Reason to revoke Client portal for Ada Advisor")).toBeTruthy();
  });

  it("carries firm, user, entitlement and mode as hidden fields", () => {
    const { container } = render(<MemberEntitlements firmId="org_firm" rows={[rows[1]]} />);
    // Exhaustive on purpose — "no MORE than these" is what stops a stray
    // setBy field being smuggled in. Order-blind, because FormData is.
    const hidden = Array.from(container.querySelectorAll("input[type=hidden]")).map(
      (i) => [i.getAttribute("name") ?? "", i.getAttribute("value") ?? ""] as [string, string],
    );
    expect(Object.fromEntries(hidden)).toEqual({
      firmId: "org_firm",
      clerkUserId: "u_b",
      entitlement: "client_portal",
      mode: "grant",
    });
    expect(hidden).toHaveLength(4);
  });

  it("sends mode=revoke for a member who currently has the capability", () => {
    const { container } = render(<MemberEntitlements firmId="org_firm" rows={[rows[0]]} />);
    expect(container.querySelector("input[name=mode]")?.getAttribute("value")).toBe("revoke");
  });

  it("shows the lockout consequence next to the Revoke that causes it", () => {
    render(<MemberEntitlements firmId="org_firm" rows={rows} />);
    // One enabled member, so exactly one warning — and it sits inside that
    // member's own form rather than in a section intro scrolled off-screen.
    const warning = screen.getByText(/locks their existing portal clients out immediately/i);
    expect(warning.closest("form")?.querySelector("input[name=clerkUserId]")?.getAttribute("value")).toBe(
      "u_a",
    );
  });

  it("does not warn about lockout where there is nothing to revoke", () => {
    render(<MemberEntitlements firmId="org_firm" rows={[rows[1]]} />);
    expect(screen.queryByText(/locks their existing portal clients out immediately/i)).toBeNull();
  });

  it("attributes an existing override to whoever set it", () => {
    render(
      <MemberEntitlements
        firmId="org_firm"
        rows={[
          {
            ...rows[1],
            caps: [cap({ overrideMode: "revoke", reason: "left the pilot", setBy: "u_ops" })],
          },
        ]}
      />,
    );
    expect(screen.getByText(/left the pilot/)).toBeTruthy();
    expect(screen.getByText(/u_ops/)).toBeTruthy();
  });

  it("renders nothing when the firm has no members", () => {
    const { container } = render(<MemberEntitlements firmId="org_firm" rows={[]} />);
    expect(container.textContent).toContain("No members");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
