// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import SettingsTabs from "../settings-tabs";

const BASE_PROPS = {
  isBillingContact: false,
  pathname: "/settings/sharing",
};

describe("SettingsTabs", () => {
  it("renders a Sharing link for org:member", () => {
    const { container } = render(<SettingsTabs {...BASE_PROPS} role="org:member" />);
    const links = Array.from(container.querySelectorAll("a"));
    const sharingLink = links.find((a) => a.textContent?.trim() === "Sharing");
    expect(sharingLink).toBeDefined();
    expect(sharingLink?.getAttribute("href")).toBe("/settings/sharing");
  });

  it("renders a Sharing link for org:admin", () => {
    const { container } = render(<SettingsTabs {...BASE_PROPS} role="org:admin" />);
    const links = Array.from(container.querySelectorAll("a"));
    const sharingLink = links.find((a) => a.textContent?.trim() === "Sharing");
    expect(sharingLink).toBeDefined();
    expect(sharingLink?.getAttribute("href")).toBe("/settings/sharing");
  });

  it("still renders a Sharing link for a null role", () => {
    // The proxy redirects every org-less request away from /settings, so a
    // role we can't read here belongs to a firm member whose Clerk role
    // string we don't recognise — not to a signed-out visitor. Hiding the
    // member tabs from them leaves an empty tab strip with nothing on screen
    // to explain it.
    const { container } = render(<SettingsTabs {...BASE_PROPS} role={null} />);
    const links = Array.from(container.querySelectorAll("a"));
    const sharingLink = links.find((a) => a.textContent?.trim() === "Sharing");
    expect(sharingLink).toBeDefined();
  });

  it("renders Sharing before Firm in tab order", () => {
    const { container } = render(<SettingsTabs {...BASE_PROPS} role="org:admin" />);
    const links = Array.from(container.querySelectorAll("a")).map((a) =>
      a.textContent?.trim(),
    );
    const sharingIdx = links.indexOf("Sharing");
    const firmIdx = links.indexOf("Firm");
    expect(sharingIdx).toBeGreaterThanOrEqual(0);
    expect(firmIdx).toBeGreaterThan(sharingIdx);
  });
});

describe("SettingsTabs — Branding tab", () => {
  it("renders a Branding link for org:member", () => {
    const { container } = render(<SettingsTabs {...BASE_PROPS} role="org:member" />);
    const links = Array.from(container.querySelectorAll("a"));
    const brandingLink = links.find((a) => a.textContent?.trim() === "Branding");
    expect(brandingLink).toBeDefined();
    expect(brandingLink?.getAttribute("href")).toBe("/settings/branding");
  });

  it("renders a Branding link for org:admin", () => {
    const { container } = render(<SettingsTabs {...BASE_PROPS} role="org:admin" />);
    const links = Array.from(container.querySelectorAll("a"));
    const brandingLink = links.find((a) => a.textContent?.trim() === "Branding");
    expect(brandingLink).toBeDefined();
    expect(brandingLink?.getAttribute("href")).toBe("/settings/branding");
  });

  // The live regression: a non-admin advisor whose Clerk role was neither
  // "org:admin" nor "org:member" lost EVERY settings tab, Branding included,
  // even with their branding grant switched on. The member tabs must not be
  // an exact-match allowlist of role strings.
  it.each([null, undefined, "org:planner", "basic_member", "org:advisor"])(
    "renders the member tabs for role %s",
    (role) => {
      const { container } = render(<SettingsTabs {...BASE_PROPS} role={role} />);
      const labels = Array.from(container.querySelectorAll("a")).map((a) =>
        a.textContent?.trim(),
      );
      expect(labels).toEqual(["Team", "Sharing", "Branding", "Voice"]);
    },
  );
});

describe("SettingsTabs — admin-only tabs", () => {
  it.each([null, undefined, "org:member", "org:planner", "org:advisor"])(
    "hides Firm and Integrations from role %s",
    (role) => {
      const { container } = render(<SettingsTabs {...BASE_PROPS} role={role} />);
      const labels = Array.from(container.querySelectorAll("a")).map((a) =>
        a.textContent?.trim(),
      );
      expect(labels).not.toContain("Firm");
      expect(labels).not.toContain("Integrations");
    },
  );

  it("shows Firm and Integrations to org:admin", () => {
    const { container } = render(<SettingsTabs {...BASE_PROPS} role="org:admin" />);
    const labels = Array.from(container.querySelectorAll("a")).map((a) =>
      a.textContent?.trim(),
    );
    expect(labels).toContain("Firm");
    expect(labels).toContain("Integrations");
  });

  it("gates Billing on the billing-contact flag, never on the role", () => {
    const { container } = render(
      <SettingsTabs isBillingContact={true} pathname="/settings/billing" role={null} />,
    );
    const labels = Array.from(container.querySelectorAll("a")).map((a) =>
      a.textContent?.trim(),
    );
    expect(labels).toContain("Billing");

    const { container: adminNoContact } = render(
      <SettingsTabs {...BASE_PROPS} role="org:admin" />,
    );
    const adminLabels = Array.from(adminNoContact.querySelectorAll("a")).map((a) =>
      a.textContent?.trim(),
    );
    expect(adminLabels).not.toContain("Billing");
  });
});
