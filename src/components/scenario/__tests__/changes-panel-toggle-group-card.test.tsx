// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToggleGroupCard } from "@/components/scenario/changes-panel-toggle-group-card";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function makeGroup(overrides: Partial<ToggleGroup> = {}): ToggleGroup {
  return {
    id: "g-1",
    scenarioId: "s-1",
    name: "Roth conversions",
    defaultOn: true,
    requiresGroupId: null,
    orderIndex: 0,
    ...overrides,
  };
}

function makeChange(overrides: Partial<ChangesPanelChange> = {}): ChangesPanelChange {
  return {
    id: "c-1",
    scenarioId: "s-1",
    opType: "add",
    targetKind: "income",
    targetId: "00000000-aaaa-bbbb-cccc-000000000001",
    payload: { name: "Side income" },
    toggleGroupId: "g-1",
    orderIndex: 0,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ToggleGroupCard", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders group name, changes count, and is collapsed by default", () => {
    render(
      <ToggleGroupCard
        clientId="c1"
        group={makeGroup({ name: "Roth conversions" })}
        changes={[makeChange(), makeChange({ id: "c-2" })]}
        allGroups={[makeGroup()]}
      />,
    );
    expect(screen.getByText("Roth conversions")).toBeInTheDocument();
    // Count badge "2" rendered inside the header button
    expect(screen.getByText("2")).toBeInTheDocument();
    // Collapsed: body is not rendered
    expect(
      screen.queryByTestId("toggle-group-card-body-g-1"),
    ).not.toBeInTheDocument();
    // aria-expanded is false on the header
    expect(screen.getByRole("button", { name: /^Roth conversions/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("clicking toggle switch fires PATCH with defaultOn flipped", async () => {
    render(
      <ToggleGroupCard
        clientId="client-x"
        group={makeGroup({ defaultOn: true })}
        changes={[]}
        allGroups={[makeGroup({ defaultOn: true })]}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Toggle group on/));
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/clients/client-x/scenarios/s-1/toggle-groups/g-1");
    expect(init).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toEqual({ defaultOn: false });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("expanded state shows requires dropdown + leaf rows", () => {
    render(
      <ToggleGroupCard
        clientId="c1"
        group={makeGroup()}
        changes={[makeChange({ id: "c-1" })]}
        allGroups={[
          makeGroup(),
          makeGroup({ id: "g-2", name: "Other group", orderIndex: 1 }),
        ]}
      />,
    );
    // Expand
    fireEvent.click(screen.getByRole("button", { name: /^Roth conversions/ }));
    expect(screen.getByTestId("toggle-group-card-body-g-1")).toBeInTheDocument();
    expect(screen.getByLabelText(/Required parent group/)).toBeInTheDocument();
    // Other group should appear as a candidate parent option (self filtered out)
    expect(screen.getByRole("option", { name: "Other group" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Roth conversions" }),
    ).not.toBeInTheDocument();
    // Leaf row renders
    expect(screen.getByTestId("leaf-row-c-1")).toBeInTheDocument();
  });

  it("setting requires fires PATCH with requiresGroupId", async () => {
    render(
      <ToggleGroupCard
        clientId="client-x"
        group={makeGroup()}
        changes={[]}
        allGroups={[
          makeGroup(),
          makeGroup({ id: "g-2", name: "Parent group", orderIndex: 1 }),
        ]}
      />,
    );
    // Expand first
    fireEvent.click(screen.getByRole("button", { name: /^Roth conversions/ }));
    fireEvent.change(screen.getByLabelText(/Required parent group/), {
      target: { value: "g-2" },
    });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/clients/client-x/scenarios/s-1/toggle-groups/g-1");
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(init.body as string)).toEqual({ requiresGroupId: "g-2" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("hides the confirm strip until the × is clicked", () => {
    render(
      <ToggleGroupCard
        clientId="c1"
        group={makeGroup()}
        changes={[]}
        allGroups={[makeGroup()]}
      />,
    );
    expect(
      screen.queryByTestId("toggle-group-confirm-delete-g-1"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Delete technique Roth conversions/));
    expect(
      screen.getByTestId("toggle-group-confirm-delete-g-1"),
    ).toBeInTheDocument();
  });

  it("Cancel closes the confirm strip without firing a network call", () => {
    render(
      <ToggleGroupCard
        clientId="c1"
        group={makeGroup()}
        changes={[]}
        allGroups={[makeGroup()]}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Delete technique Roth conversions/));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByTestId("toggle-group-confirm-delete-g-1"),
    ).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("ungroup-keep-changes fires DELETE with moveChangesTo=ungrouped and refreshes", async () => {
    render(
      <ToggleGroupCard
        clientId="client-x"
        group={makeGroup()}
        changes={[makeChange()]}
        allGroups={[makeGroup()]}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Delete technique Roth conversions/));
    fireEvent.click(screen.getByRole("button", { name: /Keep changes/ }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      "/api/clients/client-x/scenarios/s-1/toggle-groups/g-1?moveChangesTo=ungrouped",
    );
    expect(init).toMatchObject({ method: "DELETE" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("delete-changes-too fires DELETE with moveChangesTo=delete", async () => {
    render(
      <ToggleGroupCard
        clientId="client-x"
        group={makeGroup()}
        changes={[makeChange()]}
        allGroups={[makeGroup()]}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Delete technique Roth conversions/));
    fireEvent.click(screen.getByRole("button", { name: "Delete changes too" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      "/api/clients/client-x/scenarios/s-1/toggle-groups/g-1?moveChangesTo=delete",
    );
    expect(init).toMatchObject({ method: "DELETE" });
  });

  it("an empty group hides the cascade-delete option (only one destructive button)", () => {
    render(
      <ToggleGroupCard
        clientId="c1"
        group={makeGroup()}
        changes={[]}
        allGroups={[makeGroup()]}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Delete technique Roth conversions/));
    expect(
      screen.queryByRole("button", { name: "Delete changes too" }),
    ).not.toBeInTheDocument();
    // The single destructive button reads as a plain "Delete technique".
    expect(
      screen.getByRole("button", { name: "Delete technique" }),
    ).toBeInTheDocument();
  });

  it("filters out self + groups with non-null requiresGroupId from parent dropdown", () => {
    render(
      <ToggleGroupCard
        clientId="c1"
        group={makeGroup()}
        changes={[]}
        allGroups={[
          makeGroup(),
          makeGroup({ id: "g-2", name: "Top-level", orderIndex: 1 }),
          makeGroup({
            id: "g-3",
            name: "Child group",
            orderIndex: 2,
            requiresGroupId: "g-2",
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Roth conversions/ }));
    expect(screen.getByRole("option", { name: "Top-level" })).toBeInTheDocument();
    // Self excluded
    expect(
      screen.queryByRole("option", { name: "Roth conversions" }),
    ).not.toBeInTheDocument();
    // Group with non-null requiresGroupId excluded
    expect(
      screen.queryByRole("option", { name: "Child group" }),
    ).not.toBeInTheDocument();
  });
});
