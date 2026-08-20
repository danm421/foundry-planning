// src/components/portal/__tests__/rule-confirm-bar.test.tsx
// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetchMock,
}));

import { RuleConfirmBar } from "@/components/portal/rule-confirm-bar";

function renderBar(overrides: { onDismiss?: () => void; onCreated?: (n: number) => void } = {}) {
  return render(
    <RuleConfirmBar
      pattern="Wegmans"
      categoryId="l-groceries"
      categoryName="Groceries"
      onDismiss={overrides.onDismiss ?? (() => {})}
      onCreated={overrides.onCreated ?? (() => {})}
    />,
  );
}

beforeEach(() => {
  portalFetchMock.mockReset();
});

it("POSTs a contains rule and hands back how many rows it moved", async () => {
  portalFetchMock.mockResolvedValue({ ok: true, json: async () => ({ applied: 7 }) });
  const onCreated = vi.fn();
  renderBar({ onCreated });

  fireEvent.click(screen.getByRole("button", { name: /create rule/i }));

  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(7));
  expect(portalFetchMock).toHaveBeenCalledWith(
    "/api/portal/rules",
    expect.objectContaining({ method: "POST" }),
  );
  const body = JSON.parse(portalFetchMock.mock.calls[0][1].body);
  expect(body).toEqual({
    matchType: "contains",
    pattern: "Wegmans",
    categoryId: "l-groceries",
  });
});

it("dismisses without calling the API", () => {
  const onDismiss = vi.fn();
  renderBar({ onDismiss });

  fireEvent.click(screen.getByRole("button", { name: /not now/i }));

  expect(onDismiss).toHaveBeenCalled();
  expect(portalFetchMock).not.toHaveBeenCalled();
});

it("keeps the bar up and says so when the rule can't be created", async () => {
  portalFetchMock.mockResolvedValue({ ok: false });
  const onCreated = vi.fn();
  renderBar({ onCreated });

  fireEvent.click(screen.getByRole("button", { name: /create rule/i }));

  expect(await screen.findByText(/couldn't create the rule/i)).toBeTruthy();
  expect(onCreated).not.toHaveBeenCalled();
  // Still offering — the user can retry rather than losing the prompt.
  expect(screen.getByRole("button", { name: /create rule/i })).toBeTruthy();
});
