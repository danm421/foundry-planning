// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetchMock,
}));

import { AddCategoryForm } from "@/components/portal/add-category-form";

const groups = [
  { id: "g-food", name: "Food & Drink", color: "var(--data-orange)" },
  { id: "g-shop", name: "Shopping", color: "var(--data-purple)" },
];

beforeEach(() => {
  refreshMock.mockReset();
  portalFetchMock.mockReset();
});

it("creates a category in an existing group with one POST (inheriting the group color)", async () => {
  portalFetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "new-leaf" }) });
  render(<AddCategoryForm groups={groups} groupCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: /add category/i }));
  fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Coffee" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await waitFor(() => {
    expect(portalFetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(portalFetchMock.mock.calls[0][1].body)).toEqual({
      name: "Coffee",
      kind: "category",
      parentId: "g-food",
      color: "var(--data-orange)",
    });
  });
  await waitFor(() => expect(refreshMock).toHaveBeenCalled());
});

it("creates a new group then the category in it with two sequential POSTs", async () => {
  portalFetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "g-new" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "l-new" }) });
  render(<AddCategoryForm groups={groups} groupCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: /add category/i }));
  fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Tolls" } });
  fireEvent.change(screen.getByLabelText("Group"), { target: { value: "__new__" } });
  fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Transport" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await waitFor(() => expect(portalFetchMock).toHaveBeenCalledTimes(2));
  const first = JSON.parse(portalFetchMock.mock.calls[0][1].body);
  const second = JSON.parse(portalFetchMock.mock.calls[1][1].body);
  expect(first).toMatchObject({ name: "Transport", kind: "group" });
  expect(second).toMatchObject({ name: "Tolls", kind: "category", parentId: "g-new" });
});

it("validates that a category name is required", () => {
  render(<AddCategoryForm groups={groups} groupCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: /add category/i }));
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(screen.getByText(/category name/i)).toBeTruthy();
  expect(portalFetchMock).not.toHaveBeenCalled();
});
