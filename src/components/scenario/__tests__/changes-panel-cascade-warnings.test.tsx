// @vitest-environment jsdom
//
// Tests for the cascade-warnings footer chip on <ChangesPanel> (Plan 2 Task 21).
// Verifies the four UX promises from the plan:
//   1. returns null when warnings is empty
//   2. shows count + chevron, body collapsed by default
//   3. expanding shows entity label + message per warning
//   4. clicking [Restore] DELETEs the cause change with the right query params

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CascadeWarningsChip } from "@/components/scenario/changes-panel-cascade-warnings";
import type { CascadeWarning, ScenarioChange } from "@/engine/scenario/types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function makeWarning(
  overrides: Partial<CascadeWarning> = {},
): CascadeWarning {
  return {
    kind: "transfer_dropped",
    message: "Transfer dropped because source account was removed.",
    causedByChangeId: "cause-1",
    affectedEntityId: "transfer-1",
    affectedEntityLabel: "Transfer · Roth conversion 2027",
    ...overrides,
  };
}

function makeChange(overrides: Partial<ScenarioChange> = {}): ScenarioChange {
  return {
    id: "cause-1",
    scenarioId: "s1",
    opType: "remove",
    targetKind: "account",
    targetId: "11111111-2222-3333-4444-555555555555",
    payload: null,
    toggleGroupId: null,
    orderIndex: 0,
    ...overrides,
  };
}

describe("CascadeWarningsChip", () => {
  beforeEach(() => {
    refreshMock.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when warnings is empty", () => {
    const { container } = render(
      <CascadeWarningsChip
        clientId="c1"
        scenarioId="s1"
        warnings={[]}
        changes={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders count + collapsed body by default", () => {
    render(
      <CascadeWarningsChip
        clientId="c1"
        scenarioId="s1"
        warnings={[makeWarning(), makeWarning({ causedByChangeId: "cause-2" })]}
        changes={[]}
      />,
    );
    const toggle = screen.getByRole("button", { name: /CASCADE WARNING/ });
    expect(toggle).toHaveTextContent(/2 CASCADE WARNINGS/);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Body content (the warning message) should not be visible while collapsed.
    expect(
      screen.queryByText(/Transfer dropped because source account was removed/),
    ).not.toBeInTheDocument();
  });

  it("expanding shows each warning's entity label + message", () => {
    render(
      <CascadeWarningsChip
        clientId="c1"
        scenarioId="s1"
        warnings={[
          makeWarning({
            affectedEntityLabel: "Transfer · 2027",
            message: "Transfer dropped",
          }),
          makeWarning({
            kind: "savings_rule_dropped",
            affectedEntityLabel: "Savings · 401k",
            message: "Savings rule dropped",
            causedByChangeId: "cause-2",
          }),
        ]}
        changes={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /CASCADE WARNING/ }));
    expect(screen.getByText(/Transfer · 2027/)).toBeInTheDocument();
    expect(screen.getByText(/Transfer dropped/)).toBeInTheDocument();
    expect(screen.getByText(/Savings · 401k/)).toBeInTheDocument();
    expect(screen.getByText(/Savings rule dropped/)).toBeInTheDocument();
  });

  it("Restore button DELETEs the cause change with kind/target/op params", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch;

    const cause = makeChange({
      id: "cause-1",
      opType: "remove",
      targetKind: "account",
      targetId: "11111111-2222-3333-4444-555555555555",
    });
    render(
      <CascadeWarningsChip
        clientId="client-x"
        scenarioId="scenario-y"
        warnings={[makeWarning({ causedByChangeId: "cause-1" })]}
        changes={[cause]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /CASCADE WARNING/ }));
    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain(
      "/api/clients/client-x/scenarios/scenario-y/changes?",
    );
    const search = new URL(url, "http://x").searchParams;
    expect(search.get("kind")).toBe("account");
    expect(search.get("target")).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
    expect(search.get("op")).toBe("remove");
    expect(init).toMatchObject({ method: "DELETE" });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("does not render Restore when the cause change is not in the changes prop", () => {
    render(
      <CascadeWarningsChip
        clientId="c1"
        scenarioId="s1"
        warnings={[makeWarning({ causedByChangeId: "missing-cause" })]}
        changes={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /CASCADE WARNING/ }));
    expect(
      screen.queryByRole("button", { name: /Restore/ }),
    ).not.toBeInTheDocument();
  });
});
