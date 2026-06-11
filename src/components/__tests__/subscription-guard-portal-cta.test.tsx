// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

import { SubscriptionGuard } from "../subscription-guard";
import type { SubscriptionState } from "@/lib/billing/subscription-state";

async function renderState(state: SubscriptionState) {
  const node = await SubscriptionGuard({ state, isFounder: false });
  if (node) render(node);
  return node;
}

describe("<SubscriptionGuard> CTAs route to the portal entry point", () => {
  it("past_due 'Update card' links to the billing manage anchor", async () => {
    await renderState({ kind: "past_due", pastDueSince: null });
    const link = screen.getByRole("link", { name: /update card/i });
    expect(link.getAttribute("href")).toBe("/settings/billing#manage");
  });

  it("canceled_grace 'Reactivate' links to the billing manage anchor", async () => {
    await renderState({
      kind: "canceled_grace",
      archivedAt: new Date(),
      mutationsAllowed: false,
    });
    const link = screen.getByRole("link", { name: /reactivate/i });
    expect(link.getAttribute("href")).toBe("/settings/billing#manage");
  });

  it("canceled_locked 'Reactivate' links to the billing manage anchor", async () => {
    await renderState({ kind: "canceled_locked" });
    const link = screen.getByRole("link", { name: /reactivate/i });
    expect(link.getAttribute("href")).toBe("/settings/billing#manage");
  });

  it("active_canceling 'Reactivate' links to the billing manage anchor", async () => {
    await renderState({
      kind: "active_canceling",
      periodEnd: new Date("2026-06-01"),
    });
    const link = screen.getByRole("link", { name: /reactivate/i });
    expect(link.getAttribute("href")).toBe("/settings/billing#manage");
  });

  it("trialing 'Manage billing' links to the billing manage anchor", async () => {
    await renderState({
      kind: "trialing",
      trialEndsAt: new Date("2026-06-30"),
    });
    const link = screen.getByRole("link", { name: /manage billing/i });
    expect(link.getAttribute("href")).toBe("/settings/billing#manage");
  });
});
