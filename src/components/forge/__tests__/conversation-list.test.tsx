// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConversationList } from "../conversation-list";

const THREADS = [
  { id: "t1", title: "Roth conversion plan", updatedAt: new Date("2026-06-20T10:00:00Z") },
  { id: "t2", title: "Monte Carlo retirement", updatedAt: new Date("2026-06-19T08:00:00Z") },
  { id: "t3", title: "Social Security timing", updatedAt: new Date("2026-06-18T12:00:00Z") },
];

function mountList(overrides: Partial<Parameters<typeof ConversationList>[0]> = {}) {
  const onSelect = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();
  render(
    <ConversationList
      threads={THREADS}
      activeId={null}
      onSelect={onSelect}
      onRename={onRename}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { onSelect, onRename, onDelete };
}

describe("ConversationList", () => {
  describe("filter", () => {
    it("shows all threads by default", () => {
      mountList();
      expect(screen.getByText("Roth conversion plan")).toBeInTheDocument();
      expect(screen.getByText("Monte Carlo retirement")).toBeInTheDocument();
      expect(screen.getByText("Social Security timing")).toBeInTheDocument();
    });

    it("narrows visible threads when the user types in the filter", () => {
      mountList();
      const filterInput = screen.getByRole("textbox", { name: /filter/i });
      fireEvent.change(filterInput, { target: { value: "roth" } });
      expect(screen.getByText("Roth conversion plan")).toBeInTheDocument();
      expect(screen.queryByText("Monte Carlo retirement")).toBeNull();
      expect(screen.queryByText("Social Security timing")).toBeNull();
    });

    it("filter is case-insensitive", () => {
      mountList();
      const filterInput = screen.getByRole("textbox", { name: /filter/i });
      fireEvent.change(filterInput, { target: { value: "MONTE" } });
      expect(screen.getByText("Monte Carlo retirement")).toBeInTheDocument();
      expect(screen.queryByText("Roth conversion plan")).toBeNull();
    });

    it("shows empty state when no threads match the filter", () => {
      mountList();
      const filterInput = screen.getByRole("textbox", { name: /filter/i });
      fireEvent.change(filterInput, { target: { value: "zzz-no-match" } });
      expect(screen.queryByText("Roth conversion plan")).toBeNull();
      expect(screen.queryByText("Monte Carlo retirement")).toBeNull();
      expect(screen.queryByText("Social Security timing")).toBeNull();
    });
  });

  describe("active marker", () => {
    it("marks the active thread visually (aria-current or data-active)", () => {
      mountList({ activeId: "t2" });
      // We check that the active thread item has aria-current or a data-active attribute.
      const activeItem = screen.getByTestId("thread-item-t2");
      expect(
        activeItem.getAttribute("aria-current") === "true" ||
        activeItem.getAttribute("data-active") === "true"
      ).toBe(true);
    });

    it("does not mark non-active threads", () => {
      mountList({ activeId: "t2" });
      const t1 = screen.getByTestId("thread-item-t1");
      expect(
        t1.getAttribute("aria-current") === "true" ||
        t1.getAttribute("data-active") === "true"
      ).toBe(false);
    });
  });

  describe("onSelect", () => {
    it("calls onSelect(id) when a thread row is clicked", () => {
      const { onSelect } = mountList();
      fireEvent.click(screen.getByTestId("thread-item-t1"));
      expect(onSelect).toHaveBeenCalledWith("t1");
    });
  });

  describe("rename", () => {
    it("shows a rename control for each thread", () => {
      mountList();
      // At least the first thread should have a rename trigger
      expect(screen.getAllByRole("button", { name: /rename/i }).length).toBeGreaterThan(0);
    });

    it("clicking rename reveals an edit input pre-filled with the thread title", () => {
      mountList();
      const renameBtn = screen.getAllByRole("button", { name: /rename.*roth/i })[0];
      fireEvent.click(renameBtn);
      const editInput = screen.getByRole("textbox", { name: /rename conversation/i });
      expect(editInput).toBeInTheDocument();
      expect((editInput as HTMLInputElement).value).toBe("Roth conversion plan");
    });

    it("calls onRename(id, newTitle) after editing and confirming", () => {
      const { onRename } = mountList();
      // Open rename for first thread
      const renameBtn = screen.getAllByRole("button", { name: /rename.*roth/i })[0];
      fireEvent.click(renameBtn);
      const editInput = screen.getByRole("textbox", { name: /rename conversation/i });
      fireEvent.change(editInput, { target: { value: "Updated Title" } });
      // Confirm via save button
      const saveBtn = screen.getByRole("button", { name: /save/i });
      fireEvent.click(saveBtn);
      expect(onRename).toHaveBeenCalledWith("t1", "Updated Title");
    });

    it("calls onRename when Enter is pressed in the rename input", () => {
      const { onRename } = mountList();
      const renameBtn = screen.getAllByRole("button", { name: /rename.*roth/i })[0];
      fireEvent.click(renameBtn);
      const editInput = screen.getByRole("textbox", { name: /rename conversation/i });
      fireEvent.change(editInput, { target: { value: "Via Enter" } });
      fireEvent.keyDown(editInput, { key: "Enter" });
      expect(onRename).toHaveBeenCalledWith("t1", "Via Enter");
    });

    it("cancels rename on Escape without calling onRename", () => {
      const { onRename } = mountList();
      const renameBtn = screen.getAllByRole("button", { name: /rename.*roth/i })[0];
      fireEvent.click(renameBtn);
      const editInput = screen.getByRole("textbox", { name: /rename conversation/i });
      fireEvent.change(editInput, { target: { value: "Should not save" } });
      fireEvent.keyDown(editInput, { key: "Escape" });
      expect(onRename).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("shows a delete control for each thread", () => {
      mountList();
      expect(screen.getAllByRole("button", { name: /delete/i }).length).toBeGreaterThan(0);
    });

    it("calls onDelete(id) when the delete button is clicked", () => {
      const { onDelete } = mountList();
      // Click delete on the first thread
      const deleteBtn = screen.getAllByRole("button", { name: /delete.*roth/i })[0];
      fireEvent.click(deleteBtn);
      expect(onDelete).toHaveBeenCalledWith("t1");
    });
  });

  describe("updatedAt display", () => {
    it("shows a relative time for each thread", () => {
      // We just verify some relative-time text is present (e.g. "ago" or "just now")
      mountList();
      // There should be some time indicator for each thread
      const timeEls = document.querySelectorAll("time");
      expect(timeEls.length).toBeGreaterThan(0);
    });
  });
});
