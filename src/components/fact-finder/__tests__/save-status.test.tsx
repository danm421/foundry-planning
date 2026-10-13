// @vitest-environment jsdom
// src/components/fact-finder/__tests__/save-status.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaveStatus } from "../save-status";
import type { AutosaveState } from "@/components/forms/use-plan-settings-autosave";

function renderStatus(status: AutosaveState, error: string | null = null, notice: string | null = null) {
  const onRetry = vi.fn();
  const onDismiss = vi.fn();
  render(<SaveStatus status={status} error={error} notice={notice} onRetry={onRetry} onDismiss={onDismiss} />);
  return { onRetry, onDismiss };
}

describe("SaveStatus", () => {
  it("says changes save automatically, with nothing to dismiss", () => {
    renderStatus("idle");
    expect(screen.getByText("Changes save automatically")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a refused edit as an alert the advisor can dismiss", async () => {
    const { onDismiss } = renderStatus("saved", `"abc" isn't a valid Current value (a dollar amount).`);
    expect(screen.getByRole("alert")).toHaveTextContent(`"abc" isn't a valid Current value (a dollar amount).`);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows a failed save once, as Not saved with Retry", async () => {
    const { onRetry } = renderStatus("error", "Couldn't reach the server. Check your connection.");
    expect(screen.getByText("Not saved — Couldn't reach the server. Check your connection.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the dropped-edits notice quietly, with Dismiss", async () => {
    const { onDismiss } = renderStatus("saved", null, "Some of your edits weren't kept.");
    expect(screen.getByRole("status")).toHaveTextContent("Some of your edits weren't kept.");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
