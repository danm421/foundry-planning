// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FeedbackSupportDialog from "../feedback-support-dialog";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("FeedbackSupportDialog", () => {
  it("shows a Subject field in support mode, not in feedback mode", () => {
    const { rerender } = render(
      <FeedbackSupportDialog mode="support" open onOpenChange={() => {}} />,
    );
    expect(screen.getByLabelText(/subject/i)).toBeTruthy();
    rerender(<FeedbackSupportDialog mode="feedback" open onOpenChange={() => {}} />);
    expect(screen.queryByLabelText(/subject/i)).toBeNull();
    expect(screen.getByRole("group", { name: /type/i })).toBeTruthy();
  });

  it("blocks submit until the message is filled", async () => {
    render(<FeedbackSupportDialog mode="support" open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts to /api/feedback and shows a success state", async () => {
    render(<FeedbackSupportDialog mode="feedback" open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "Chart is blank" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/feedback");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
    await screen.findByText(/thanks/i);
  });
});
