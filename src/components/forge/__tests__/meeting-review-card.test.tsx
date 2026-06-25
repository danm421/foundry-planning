// @vitest-environment jsdom
// src/components/forge/__tests__/meeting-review-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetingReviewCard } from "../meeting-review-card";

const review = {
  summaryTitle: "Annual review",
  summary: "Recap of the meeting.",
  meetingDate: "2026-06-25",
  proposedTasks: [
    { title: "Send IPS", description: "", priority: "med" as const, dueDate: null },
    { title: "Open 529", description: "", priority: "low" as const, dueDate: null },
  ],
};

describe("MeetingReviewCard", () => {
  it("approves with only the kept (checked) tasks", () => {
    const onApprove = vi.fn();
    render(<MeetingReviewCard review={review} busy={false} onApprove={onApprove} onCancel={() => {}} />);
    // Drop the second task.
    fireEvent.click(screen.getByLabelText(/exclude Open 529/i));
    fireEvent.click(screen.getByRole("button", { name: /save to crm/i }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({
      approved: true,
      tasks: [expect.objectContaining({ title: "Send IPS" })],
    }));
  });
  it("edits a task title before approving", () => {
    const onApprove = vi.fn();
    render(<MeetingReviewCard review={review} busy={false} onApprove={onApprove} onCancel={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("Send IPS"), { target: { value: "Send IPS to Jane" } });
    fireEvent.click(screen.getByRole("button", { name: /save to crm/i }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({
      tasks: expect.arrayContaining([expect.objectContaining({ title: "Send IPS to Jane" })]),
    }));
  });
  it("falls back to today when the date is cleared (never emits an empty date)", () => {
    const onApprove = vi.fn();
    render(<MeetingReviewCard review={review} busy={false} onApprove={onApprove} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/meeting date/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save to crm/i }));
    expect(onApprove).toHaveBeenCalledWith(
      expect.objectContaining({ meetingDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    );
  });
});
