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
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grant" })).toBeTruthy();
  });

  it("carries firm, user, entitlement and mode as hidden fields", () => {
    const { container } = render(<MemberEntitlements firmId="org_firm" rows={[rows[1]]} />);
    const hidden = Array.from(container.querySelectorAll("input[type=hidden]")).map((i) => [
      i.getAttribute("name"),
      i.getAttribute("value"),
    ]);
    expect(hidden).toEqual([
      ["firmId", "org_firm"],
      ["clerkUserId", "u_b"],
      ["entitlement", "client_portal"],
      ["mode", "grant"],
    ]);
  });

  it("sends mode=revoke for a member who currently has the capability", () => {
    const { container } = render(<MemberEntitlements firmId="org_firm" rows={[rows[0]]} />);
    expect(container.querySelector("input[name=mode]")?.getAttribute("value")).toBe("revoke");
  });

  it("shows the lockout consequence so it is never a surprise", () => {
    render(<MemberEntitlements firmId="org_firm" rows={rows} />);
    expect(screen.getByText(/locks their existing portal clients out immediately/i)).toBeTruthy();
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
