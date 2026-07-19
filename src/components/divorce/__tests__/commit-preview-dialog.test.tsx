// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import DivorceWorkbench from "../divorce-workbench";
import type { WorkbenchPayload } from "@/lib/divorce/divorce-plans";
import type { DivisibleObject } from "@/lib/divorce/allocation-rules";
import type { CommitPreview } from "@/lib/divorce/commit-preview";
import type { CommitResult } from "@/lib/divorce/commit-divorce-plan";

// ── Fixtures ──────────────────────────────────────────────────────────────
const primaryIncome: DivisibleObject = {
  kind: "income",
  id: "11111111-1111-1111-1111-111111111111",
  label: "Salary",
  subtype: null,
  value: 0,
  basis: 0,
  rothValue: 0,
  annualAmount: 120000,
  ownerSide: "primary",
  entityOwnedById: null,
  childIds: [],
};

// Joint cash → default primary, needsDecision=true → a decision remains.
const jointAccount: DivisibleObject = {
  kind: "account",
  id: "22222222-2222-2222-2222-222222222222",
  label: "Joint Savings",
  subtype: "cash",
  value: 1000,
  basis: 0,
  rothValue: 0,
  annualAmount: 0,
  ownerSide: "joint",
  entityOwnedById: null,
  childIds: [],
};

function makePayload(objects: DivisibleObject[] = [primaryIncome]): WorkbenchPayload {
  const plan = {
    splitYear: 2026,
    primaryFilingStatus: "single",
    spouseFilingStatus: "single",
    spouseState: "NY",
  } as unknown as WorkbenchPayload["plan"];
  return {
    plan,
    objects,
    allocations: [],
    resolved: [],
    totals: {
      primary: { netWorth: 0, annualIncome: 0, annualExpenses: 0 },
      spouse: { netWorth: 0, annualIncome: 0, annualExpenses: 0 },
    },
    people: { primaryName: "Alex Kim", spouseName: "Jordan Kim" },
  };
}

const cleanPreview: CommitPreview = {
  blockers: [],
  totals: {
    primary: { netWorth: 500000, annualIncome: 120000, annualExpenses: 60000, name: "Alex Kim" },
    spouse: { netWorth: 300000, annualIncome: 80000, annualExpenses: 40000, name: "Jordan Kim" },
  },
  actions: [
    { kind: "account", id: "a1", label: "Brokerage", disposition: "spouse", detail: "moves to Jordan Kim" },
  ],
  warnings: [
    {
      code: "straddle_dropped",
      label: "Rebalance transfer",
      detail: "Transfers between accounts landing on different households — dropped on commit.",
    },
  ],
  cleanup: [
    { source: "beneficiary_designation", id: "bd1", label: "401(k) names Jordan Kim", side: "primary", remove: true, forced: false },
  ],
  informational: ["Tax returns stay with Alex Kim"],
};

// A preview whose sole cleanup row is structurally forced — its removal rides on
// the departing spouse's family record and can't be kept, so it renders
// read-only (disabled + a plain-voice note).
const forcedCleanupPreview: CommitPreview = {
  ...cleanPreview,
  cleanup: [
    {
      source: "beneficiary_designation",
      id: "bd-forced",
      label: "Primary Brokerage names Jordan Kim",
      side: "primary",
      remove: true,
      forced: true,
    },
  ],
};

const blockedPreview: CommitPreview = {
  ...cleanPreview,
  blockers: [
    { code: "non_base_scenarios", label: "2 what-if scenarios must be promoted or discarded first", count: 2 },
  ],
};

const commitResult: CommitResult = {
  spouseClientId: "spouse-client-123",
  spouseHouseholdId: "h1",
  spouseScenarioId: "s1",
  snapshotId: "snap1",
  warnings: ["Rebalance transfer dropped on commit"],
};

// ── Fetch mock: dispatch by URL suffix ─────────────────────────────────────
const ok = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body } as Response);
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body } as Response);

function installFetch(opts: { preview?: () => Response; commit?: () => Response } = {}) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/preview")) return (opts.preview ?? (() => ok(cleanPreview)))();
    if (url.endsWith("/commit")) return (opts.commit ?? (() => ok(commitResult)))();
    // Settings PATCH / allocations PUT echo a payload back.
    return ok(makePayload());
  }) as unknown as typeof fetch;
}

/** Drive the dialog from closed → confirm step, with a matching typed name. */
async function openToConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Review and commit" }));
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Jordan" } });
}

describe("CommitPreviewDialog flow", () => {
  beforeEach(() => installFetch());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("disables the commit CTA while any object still needs a decision", () => {
    render(<DivorceWorkbench payload={makePayload([jointAccount])} clientId="c1" />);
    expect(screen.getByRole("button", { name: "Review and commit" })).toBeDisabled();
  });

  it("enables the commit CTA once every object is decided", () => {
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);
    expect(screen.getByRole("button", { name: "Review and commit" })).toBeEnabled();
  });

  it("renders preview blockers and keeps the commit gated", async () => {
    installFetch({ preview: () => ok(blockedPreview) });
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Review and commit" }));

    expect(
      await screen.findByText("2 what-if scenarios must be promoted or discarded first"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("renders a clean preview and lets the advisor continue", async () => {
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Review and commit" }));

    // Blocker-free preview surfaces its content and enables Continue.
    const cont = await screen.findByRole("button", { name: "Continue" });
    expect(cont).toBeEnabled();
    expect(screen.getByText("Brokerage")).toBeTruthy();
    expect(screen.getByText("Rebalance transfer")).toBeTruthy();
    expect(screen.getByText("401(k) names Jordan Kim")).toBeTruthy();
    expect(screen.getByText("Tax returns stay with Alex Kim")).toBeTruthy();
  });

  it("only enables the destructive button on a case-insensitive first-name match", async () => {
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Review and commit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    const dialog = within(screen.getByRole("dialog"));
    const create = () => screen.getByRole("button", { name: "Create separate household" });
    expect(create()).toBeDisabled();

    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "wrong" } });
    expect(create()).toBeDisabled();

    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "jordan" } });
    expect(create()).toBeEnabled();
  });

  it("commits and replaces the workbench with the two-households success state", async () => {
    installFetch({ preview: () => ok(cleanPreview), commit: () => ok(commitResult) });
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);

    await openToConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create separate household" }));

    expect(await screen.findByText("Two households created.")).toBeTruthy();
    const primaryLink = screen.getByRole("link", { name: /Open Alex Kim/ });
    const spouseLink = screen.getByRole("link", { name: /Open Jordan Kim/ });
    expect(primaryLink).toHaveAttribute("href", "/clients/c1");
    expect(spouseLink).toHaveAttribute("href", "/clients/spouse-client-123");
    // Post-commit warnings surface; the commit CTA is gone (cannot run twice).
    expect(screen.getByText("Rebalance transfer dropped on commit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review and commit" })).toBeNull();
  });

  it("re-renders blockers and returns to the preview when the commit is blocked (422)", async () => {
    installFetch({
      preview: () => ok(cleanPreview),
      commit: () =>
        fail(422, {
          error: "blocked",
          blockers: [
            {
              code: "import_in_flight",
              label: "An import is in progress — finish or discard it before committing",
              count: 1,
            },
          ],
        }),
    });
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);

    await openToConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create separate household" }));

    expect(
      await screen.findByText("An import is in progress — finish or discard it before committing"),
    ).toBeTruthy();
    // Back on the preview step with the new blocker gating Continue.
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("surfaces the in-progress message on a 409", async () => {
    installFetch({ preview: () => ok(cleanPreview), commit: () => fail(409, { error: "concurrent" }) });
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);

    await openToConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create separate household" }));

    expect(await screen.findByText("Commit already in progress.")).toBeTruthy();
  });

  it("shows the unresolvable-measuring-life message verbatim on a 422", async () => {
    const message =
      'The charitable remainder trust "Smith CRT" names Jordan as its measuring life. Reassign the measuring life or the trust before committing.';
    installFetch({
      preview: () => ok(cleanPreview),
      commit: () => fail(422, { error: "unresolvable_measuring_life", code: "unresolvable_measuring_life", message }),
    });
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);

    await openToConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Create separate household" }));

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("renders a forced cleanup row non-interactively with the family-record note", async () => {
    installFetch({ preview: () => ok(forcedCleanupPreview) });
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Review and commit" }));

    // The row is shown (so the advisor knows it's going away) but the checkbox
    // is checked + disabled — the "keep" choice can't be honored.
    const checkbox = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getByText("Primary Brokerage names Jordan Kim")).toBeTruthy();
    expect(screen.getByText("Removed with Jordan's family record")).toBeTruthy();

    // Clicking a disabled checkbox fires no change → no settings PATCH.
    fireEvent.click(checkbox);
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([, init]) => (init as RequestInit)?.method === "PATCH")).toBe(false);
  });

  it("persists a cleanup toggle through the settings PATCH (beneficiaryCleanup.selections)", async () => {
    installFetch({ preview: () => ok(cleanPreview) });
    render(<DivorceWorkbench payload={makePayload([primaryIncome])} clientId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Review and commit" }));

    const checkbox = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(checkbox).toBeChecked(); // preview default remove:true

    vi.useFakeTimers();
    fireEvent.click(checkbox); // → remove:false
    await vi.advanceTimersByTimeAsync(400); // flush the 400ms settings debounce
    vi.useRealTimers();

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const patch = calls.find(([, init]) => (init as RequestInit)?.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch![0]).toBe("/api/clients/c1/divorce-plan");
    const body = JSON.parse((patch![1] as RequestInit).body as string);
    expect(body.beneficiaryCleanup.selections).toEqual([
      { source: "beneficiary_designation", id: "bd1", remove: false },
    ]);
  });
});
