// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockCookies = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => mockCookies(),
}));

import { SubscriptionGuard } from "../subscription-guard";
import type { SubscriptionState } from "@/lib/billing/subscription-state";

beforeEach(() => {
  mockCookies.mockReturnValue({ get: () => undefined });
});

async function renderGuard(
  state: SubscriptionState,
  opts: { isFounder?: boolean; previewKind?: string; previewDate?: string } = {},
) {
  const node = await SubscriptionGuard({
    state,
    isFounder: opts.isFounder ?? false,
    preview: opts.previewKind
      ? { kind: opts.previewKind, date: opts.previewDate }
      : undefined,
  });
  if (node) render(node);
}

describe("<SubscriptionGuard>", () => {
  it("renders nothing for founder", async () => {
    await renderGuard({ kind: "founder" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing for active", async () => {
    await renderGuard({ kind: "active" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders trialing banner with trial-end date", async () => {
    await renderGuard({
      kind: "trialing",
      trialEndsAt: new Date("2026-05-15T00:00:00Z"),
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Trial ends");
    expect(screen.getByRole("alert")).toHaveTextContent("payment method");
  });

  it("renders past_due banner with persistent (non-dismissible) variant", async () => {
    await renderGuard({ kind: "past_due" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Payment failed");
    expect(alert.querySelector('[data-dismiss="true"]')).toBeNull();
  });

  it("renders canceled_grace banner with archivedAt+30d hint", async () => {
    await renderGuard({
      kind: "canceled_grace",
      archivedAt: new Date("2026-04-01T00:00:00Z"),
      mutationsAllowed: false,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Read-only");
  });

  it("renders canceled_locked banner", async () => {
    await renderGuard({ kind: "canceled_locked" });
    expect(screen.getByRole("alert")).toHaveTextContent("Account locked");
  });

  it("renders missing banner", async () => {
    await renderGuard({ kind: "missing", reason: "no_metadata" });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't read");
  });

  it("short-circuits to null when dismissal cookie matches state key", async () => {
    mockCookies.mockReturnValue({
      get: (name: string) =>
        name === "sub-banner-dismissed"
          ? { value: "trialing:2026-05-15T00:00:00.000Z" }
          : undefined,
    });
    await renderGuard({
      kind: "trialing",
      trialEndsAt: new Date("2026-05-15T00:00:00Z"),
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores preview override when isFounder=false", async () => {
    await renderGuard(
      { kind: "active" },
      { isFounder: false, previewKind: "trialing", previewDate: "2026-05-15" },
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("honors preview override when isFounder=true", async () => {
    await renderGuard(
      { kind: "active" },
      { isFounder: true, previewKind: "trialing", previewDate: "2026-05-15" },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Trial ends");
  });

  it("renders dismiss button only for info-severity banners", async () => {
    await renderGuard({
      kind: "trialing",
      trialEndsAt: new Date("2026-05-15T00:00:00Z"),
    });
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });
});
