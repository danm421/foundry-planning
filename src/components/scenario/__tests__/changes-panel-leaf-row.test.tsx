// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangesPanelLeafRow } from "@/components/scenario/changes-panel-leaf-row";
import type { ScenarioChange } from "@/engine/scenario/types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function makeChange(overrides: Partial<ScenarioChange> = {}): ScenarioChange {
  return {
    id: "change-1",
    scenarioId: "scenario-1",
    opType: "add",
    targetKind: "income",
    targetId: "00000000-aaaa-bbbb-cccc-000000000001",
    payload: { name: "Consulting income" },
    toggleGroupId: null,
    orderIndex: 0,
    ...overrides,
  };
}

describe("ChangesPanelLeafRow", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders + glyph for add op", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        enabled={true}
        change={makeChange({ opType: "add" })}
      />,
    );
    expect(screen.getByLabelText("add")).toHaveTextContent("+");
    expect(screen.getByText(/Added in this scenario/)).toBeInTheDocument();
  });

  it("renders − glyph for remove op", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        enabled={true}
        change={makeChange({ opType: "remove", payload: null })}
      />,
    );
    expect(screen.getByLabelText("remove")).toHaveTextContent("−");
    expect(screen.getByText(/Removed in this scenario/)).toBeInTheDocument();
  });

  it("renders Δ glyph for edit op + subtext shows field diff", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        enabled={true}
        change={makeChange({
          opType: "edit",
          payload: { annualAmount: { from: 100000, to: 250000 } },
        })}
      />,
    );
    expect(screen.getByLabelText("edit")).toHaveTextContent("Δ");
    expect(
      screen.getByText(/annualAmount: Base 100000 → Scenario 250000/),
    ).toBeInTheDocument();
  });

  describe("delete confirmation", () => {
    it("does not delete on first trash click; shows a confirm popover", () => {
      render(
        <ChangesPanelLeafRow
          clientId="c1"
          scenarioId="s1"
          enabled={true}
          change={makeChange()}
        />,
      );
      fireEvent.click(screen.getByLabelText("Delete change"));
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(screen.getByText(/delete this change\?/i)).toBeInTheDocument();
    });

    it("Cancel dismisses the popover without deleting", () => {
      render(
        <ChangesPanelLeafRow
          clientId="c1"
          scenarioId="s1"
          enabled={true}
          change={makeChange()}
        />,
      );
      fireEvent.click(screen.getByLabelText("Delete change"));
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(screen.queryByText(/delete this change\?/i)).toBeNull();
    });

    it("confirming Delete fires the DELETE request on the changes route", async () => {
      const change = makeChange({
        opType: "edit",
        targetKind: "income",
        targetId: "target-uuid",
        payload: { annualAmount: { from: 1, to: 2 } },
      });
      render(
        <ChangesPanelLeafRow
          clientId="client-x"
          scenarioId="scenario-y"
          enabled={true}
          change={change}
        />,
      );
      fireEvent.click(screen.getByLabelText("Delete change"));
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(String(url)).toBe(
        "/api/clients/client-x/scenarios/scenario-y/changes?kind=income&target=target-uuid&op=edit",
      );
      expect(init).toEqual({ method: "DELETE" });
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    });
  });

  it("uses targetName prop when provided (op=edit case where payload has no name)", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        enabled={true}
        targetName="Salary"
        change={makeChange({
          opType: "edit",
          targetKind: "income",
          payload: { annualAmount: { from: 100000, to: 250000 } },
        })}
      />,
    );
    expect(screen.getByText("Salary")).toBeInTheDocument();
  });

  it("falls back to payload.name when targetName is undefined and op=add", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        enabled={true}
        change={makeChange({
          opType: "add",
          targetKind: "income",
          payload: { name: "Consulting income" },
        })}
      />,
    );
    expect(screen.getByText("Consulting income")).toBeInTheDocument();
  });

  it("shows bare humanized kind (never a UUID) when targetName and payload.name are both unavailable", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        enabled={true}
        change={makeChange({
          opType: "edit",
          targetKind: "income",
          targetId: "abcdef12-3456-7890-aaaa-000000000000",
          payload: { annualAmount: { from: 1, to: 2 } },
        })}
      />,
    );
    expect(screen.getByText("Income")).toBeInTheDocument();
  });

  it("toggle PATCHes { enabled: false } when an enabled row is flipped off, then router.refresh()", async () => {
    const change = makeChange({
      id: "abc-123",
      targetId: "00000000-aaaa-bbbb-cccc-000000000001",
    });
    render(
      <ChangesPanelLeafRow
        clientId="client-x"
        scenarioId="scenario-y"
        enabled={true}
        change={change}
      />,
    );

    const toggle = screen.getByLabelText("Disable change");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      "/api/clients/client-x/scenarios/scenario-y/changes/abc-123",
    );
    expect(init).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    // Optimistic state — the aria label should have flipped immediately.
    expect(screen.getByLabelText("Enable change")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("rolls back optimistic state when the PATCH fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        enabled={true}
        change={makeChange()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Disable change"));
    // After the failed response, the toggle should snap back to "on".
    await waitFor(() => {
      expect(screen.getByLabelText("Disable change")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("disabled row renders the toggle in the off position with 'Enable change' label", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        enabled={false}
        change={makeChange()}
      />,
    );
    const toggle = screen.getByLabelText("Enable change");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  describe("rename", () => {
    it("opens an editor prefilled with the current title and saves a label", async () => {
      render(
        <ChangesPanelLeafRow
          clientId="cli-1"
          scenarioId="scn-1"
          enabled={true}
          targetName="401(k) · max"
          change={makeChange({
            id: "chg-1",
            opType: "edit",
            targetKind: "savings_rule",
            payload: { rothPercent: { from: null, to: 1 } },
          })}
        />,
      );
      fireEvent.click(screen.getByLabelText("Rename change"));
      const input = screen.getByRole("textbox", { name: /change label/i }) as HTMLInputElement;
      expect(input.value).toBe("401(k) · max");
      fireEvent.change(input, { target: { value: "Max out 401(k)" } });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(String(url)).toBe("/api/clients/cli-1/scenarios/scn-1/changes/chg-1");
      expect(init).toMatchObject({ method: "PATCH" });
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ label: "Max out 401(k)" });
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    });

    it("Escape cancels without saving", () => {
      render(
        <ChangesPanelLeafRow clientId="cli-1" scenarioId="scn-1" enabled={true} change={makeChange()} />,
      );
      fireEvent.click(screen.getByLabelText("Rename change"));
      const input = screen.getByRole("textbox", { name: /change label/i });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox", { name: /change label/i })).toBeNull();
    });

    it("Reset to default sends label:null when a custom label is set", async () => {
      render(
        <ChangesPanelLeafRow
          clientId="cli-1"
          scenarioId="scn-1"
          enabled={true}
          customLabel="Max out 401(k)"
          change={makeChange({ id: "chg-1" })}
        />,
      );
      fireEvent.click(screen.getByLabelText("Rename change"));
      fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ label: null });
    });
  });

});
