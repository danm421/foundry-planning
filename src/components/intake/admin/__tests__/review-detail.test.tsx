// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReviewDetail from "../review-detail";
import type { IntakeFormRow } from "@/lib/intake/queries";
import type { IntakeDiff } from "../diff-utils";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function makeForm(overrides: Partial<IntakeFormRow> = {}): IntakeFormRow {
  return {
    id: "form-1",
    firmId: "firm-1",
    clientId: "client-1",
    mode: "prefilled",
    status: "submitted",
    token: "tok-abc",
    recipientEmail: "jane@example.com",
    recipientName: "Jane Doe",
    payload: {} as IntakeFormRow["payload"],
    createdByUserId: "user-1",
    sentAt: null,
    submittedAt: new Date("2026-06-20"),
    appliedAt: null,
    expiresAt: new Date("2026-12-31"),
    createdAt: new Date("2026-06-01"),
    updatedAt: new Date("2026-06-01"),
    ...overrides,
  };
}

const baseDiff: IntakeDiff = {
  family: {
    primaryName: { changed: true, old: "Jane Old", new: "Jane Doe" },
    primaryDob: { changed: false, value: "1975-06-15" },
    primaryMarital: { changed: false, value: "married" },
    spouseName: { changed: false, value: undefined },
    spouseDob: { changed: false, value: undefined },
    stateOfResidence: { changed: false, value: "CA" },
    childrenCount: { changed: false, value: 1 },
  },
  goals: {
    clientRetirementAge: { changed: true, old: 62, new: 65 },
    spouseRetirementAge: { changed: false, value: undefined },
    annualRetirementExpenses: { changed: false, value: 80000 },
  },
  accounts: {
    baselineCount: 2,
    submittedCount: 3,
    submittedItems: [
      { name: "Fidelity", value: 100000, secondary: "taxable" },
      { name: "Roth IRA", value: 50000, secondary: "retirement" },
      { name: "Checking", value: 5000, secondary: "cash" },
    ],
  },
  income: { baselineCount: 1, submittedCount: 1, submittedItems: [{ name: "Salary", value: 120000, secondary: "salary" }] },
  property: { baselineCount: 0, submittedCount: 1, submittedItems: [{ name: "Home", value: 800000, secondary: "real_estate" }] },
};

describe("ReviewDetail", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
  });

  it("renders submission details header", () => {
    render(<ReviewDetail form={makeForm()} diff={baseDiff} />);
    // Jane Doe appears in both the recipient row and the diff — getAllByText handles it
    expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0);
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
  });

  it("renders diff sections", () => {
    render(<ReviewDetail form={makeForm()} diff={baseDiff} />);
    expect(screen.getByText(/family/i)).toBeInTheDocument();
    expect(screen.getByText(/goals/i)).toBeInTheDocument();
    expect(screen.getByText(/accounts/i)).toBeInTheDocument();
  });

  it("shows Apply and Discard buttons for submitted form", () => {
    render(<ReviewDetail form={makeForm()} diff={baseDiff} />);
    expect(screen.getByRole("button", { name: /apply entire form/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
  });

  it("clicking Apply POSTs to apply route", async () => {
    render(<ReviewDetail form={makeForm()} diff={baseDiff} />);
    fireEvent.click(screen.getByRole("button", { name: /apply entire form/i }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/data-collection/form-1/apply", { method: "POST" });
    });
  });

  it("clicking Discard POSTs to discard route", async () => {
    render(<ReviewDetail form={makeForm()} diff={baseDiff} />);
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/data-collection/form-1/discard", { method: "POST" });
    });
  });

  it("shows 409 error inline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) }));
    render(<ReviewDetail form={makeForm()} diff={baseDiff} />);
    fireEvent.click(screen.getByRole("button", { name: /apply entire form/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/already been applied or discarded/i);
    });
  });

  it("hides action buttons for already-applied form", () => {
    render(<ReviewDetail form={makeForm({ status: "applied" })} diff={baseDiff} />);
    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
    // "applied" text appears in both the status row and the actioned message
    expect(screen.getAllByText(/applied/i).length).toBeGreaterThan(0);
  });

  it("prospect form (no clientId) renders without baseline crash", () => {
    const prospectDiff: IntakeDiff = {
      ...baseDiff,
      family: {
        ...baseDiff.family,
        primaryName: { changed: false, value: "Jane Doe" },
      },
      accounts: { baselineCount: 0, submittedCount: 2, submittedItems: [{ name: "Savings", value: 5000 }] },
    };
    render(<ReviewDetail form={makeForm({ clientId: null, mode: "blank" })} diff={prospectDiff} />);
    expect(screen.getByText(/prospect/i)).toBeInTheDocument();
  });
});
