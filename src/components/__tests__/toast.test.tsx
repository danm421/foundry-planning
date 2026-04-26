// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "@/components/toast";

function Trigger({ undo }: { undo?: () => void }) {
  const { showToast } = useToast();
  return (
    <button
      onClick={() =>
        showToast({
          message: "Done",
          undo: undo ? { label: "Undo", onClick: undo } : undefined,
          durationMs: 8000,
        })
      }
    >
      fire
    </button>
  );
}

describe("ToastProvider / useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the message after showToast", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ToastProvider><Trigger /></ToastProvider>);
    await user.click(screen.getByText("fire"));
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("auto-dismisses after the configured duration", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ToastProvider><Trigger /></ToastProvider>);
    await user.click(screen.getByText("fire"));
    expect(screen.getByText("Done")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  it("fires the undo callback and dismisses", async () => {
    const undo = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ToastProvider><Trigger undo={undo} /></ToastProvider>);
    await user.click(screen.getByText("fire"));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  it("supports manual dismiss via the close button", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ToastProvider><Trigger /></ToastProvider>);
    await user.click(screen.getByText("fire"));
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });
});
