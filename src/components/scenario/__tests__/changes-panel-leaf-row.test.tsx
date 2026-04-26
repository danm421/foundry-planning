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

  it("clicking ↶ revert calls fetch with DELETE on the changes route", async () => {
    const change = makeChange({
      opType: "edit",
      targetKind: "income",
      targetId: "target-uuid",
      payload: { annualAmount: { from: 1, to: 2 } },
    });
    render(
      <ChangesPanelLeafRow clientId="client-x" scenarioId="scenario-y" change={change} />,
    );
    fireEvent.click(screen.getByLabelText("Revert change"));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      "/api/clients/client-x/scenarios/scenario-y/changes?kind=income&target=target-uuid&op=edit",
    );
    expect(init).toEqual({ method: "DELETE" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("uses targetName prop when provided (op=edit case where payload has no name)", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        targetName="Salary"
        change={makeChange({
          opType: "edit",
          targetKind: "income",
          payload: { annualAmount: { from: 100000, to: 250000 } },
        })}
      />,
    );
    expect(screen.getByText("Income — Salary")).toBeInTheDocument();
  });

  it("falls back to payload.name when targetName is undefined and op=add", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        change={makeChange({
          opType: "add",
          targetKind: "income",
          payload: { name: "Consulting income" },
        })}
      />,
    );
    expect(screen.getByText("Income — Consulting income")).toBeInTheDocument();
  });

  it("falls back to UUID slice when targetName and payload.name are both unavailable", () => {
    render(
      <ChangesPanelLeafRow
        clientId="c1"
        scenarioId="s1"
        change={makeChange({
          opType: "edit",
          targetKind: "income",
          targetId: "abcdef12-3456-7890-aaaa-000000000000",
          payload: { annualAmount: { from: 1, to: 2 } },
        })}
      />,
    );
    expect(screen.getByText("Income — abcdef12")).toBeInTheDocument();
  });

});
