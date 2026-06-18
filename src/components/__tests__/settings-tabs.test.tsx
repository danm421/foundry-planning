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

  it("does not render a Sharing link for null role (unauthenticated / no org)", () => {
    const { container } = render(<SettingsTabs {...BASE_PROPS} role={null} />);
    const links = Array.from(container.querySelectorAll("a"));
    const sharingLink = links.find((a) => a.textContent?.trim() === "Sharing");
    expect(sharingLink).toBeUndefined();
  });

  it("does not render a Sharing link when the billing contact flag is the only gate", () => {
    // Billing contact role doesn't grant Sharing visibility.
    // We simulate a billing-contact-only user by passing no org role but setting isBillingContact.
    const { container } = render(
      <SettingsTabs isBillingContact={true} pathname="/settings/billing" role={null} />,
    );
    const links = Array.from(container.querySelectorAll("a"));
    const sharingLink = links.find((a) => a.textContent?.trim() === "Sharing");
    expect(sharingLink).toBeUndefined();
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
