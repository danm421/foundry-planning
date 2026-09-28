// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import AddAccountForm, { type AccountFormInitial, type AccountFormAutoSaveHandle } from "../add-account-form";
import type { ClientMilestones } from "@/lib/milestones";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-123",
}));

const FAMILY = [
  { id: "fm-client", role: "client" as const, firstName: "Alice" },
  { id: "fm-spouse", role: "spouse" as const, firstName: "Bob" },
];
const MILESTONES: ClientMilestones = {
  planStart: 2026, planEnd: 2070, clientRetirement: 2040, clientEnd: 2070, clientBirthYear: 1975,
};
const CATEGORY_DEFAULTS = {
  taxable: "0.07", cash: "0.02", retirement: "0.07", annuity: "0.04",
  real_estate: "0.04", business: "0.05", life_insurance: "0.03", notes_receivable: "0",
};
const INHERITED: AccountFormInitial = {
  id: "acct-1", name: "Inherited IRA", category: "retirement", subType: "traditional_ira",
  owner: "client", value: "400000", basis: "0", growthRate: "0.07", rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
  inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (/savings-rules|allocations|holdings/.test(String(url))) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ id: "acct-1" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderForm(initial: AccountFormInitial, extra: Record<string, unknown> = {}) {
  return render(
    <AddAccountForm
      clientId="client-123" category="retirement" mode="edit" initial={initial}
      familyMembers={FAMILY} entities={[]} categoryDefaults={CATEGORY_DEFAULTS} milestones={MILESTONES}
      {...extra}
    />,
  );
}

async function putBody() {
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/clients/client-123/accounts/acct-1", expect.objectContaining({ method: "PUT" })),
  );
  const call = fetchMock.mock.calls.find((a) => String(a[0]) === "/api/clients/client-123/accounts/acct-1");
  return JSON.parse(call![1].body as string);
}

describe("AddAccountForm — inherited IRA on the RMD tab", () => {
  it("round-trips a saved inherited IRA and hides 'Subject to RMDs'", async () => {
    renderForm(INHERITED);
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    expect((screen.getByLabelText("Inherited from someone other than a spouse") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("Subject to RMDs")).toBeNull();
    expect(screen.getByTestId("inherited-rule-summary").textContent).toContain("Dec 31, 2032");

    fireEvent.submit(document.getElementById("add-account-form")!);
    const body = await putBody();
    expect(body).toMatchObject({ inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: false });
  });

  it("un-ticking writes nulls", async () => {
    renderForm(INHERITED);
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    fireEvent.click(screen.getByLabelText("Inherited from someone other than a spouse"));
    fireEvent.submit(document.getElementById("add-account-form")!);
    const body = await putBody();
    expect(body).toMatchObject({ inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false });
  });

  // Ride-along (Fix round 1, finding 3): Review Focus #1 names "the form PUT
  // body" without restricting it to the submit path — before this, only the
  // submit-path body builder's null-out was pinned; the saveAsyncImpl body
  // builder has its own separate `...inheritedFields` spread that could
  // regress independently.
  it("un-ticking writes nulls via the saveAsync (autosave) path too", async () => {
    const ref = createRef<AccountFormAutoSaveHandle>();
    renderForm(INHERITED, { ref });
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    fireEvent.click(screen.getByLabelText("Inherited from someone other than a spouse"));
    await act(async () => { await ref.current!.saveAsync(); });
    const body = await putBody();
    expect(body).toMatchObject({ inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false });
  });

  it("the tab-switch autosave path (imperative saveAsync) carries the fields too", async () => {
    const ref = createRef<AccountFormAutoSaveHandle>();
    renderForm(INHERITED, { ref });
    await act(async () => { await ref.current!.saveAsync(); });
    const body = await putBody();
    expect(body).toMatchObject({ inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945 });
  });

  it("blocks saving while the box is ticked with a year missing", async () => {
    const onAutoSaveStateChange = vi.fn();
    renderForm({ ...INHERITED, inheritedDeathYear: null, inheritedOwnerBirthYear: null }, { onAutoSaveStateChange });
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    fireEvent.click(screen.getByLabelText("Inherited from someone other than a spouse"));
    await waitFor(() => expect(onAutoSaveStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ canSave: false })));
    expect(screen.getByRole("alert").textContent).toContain("Enter the year of death");
  });

  // Pins only that the tab panel RENDERS the Prior Dec 31 Balance field for an
  // inherited IRA with `rmdEnabled: false` — i.e. the `(rmdEnabled ||
  // inheritedActive)` condition guarding the tab-panel block. It does NOT pin
  // that a typed value reaches either PUT body's `...inheritedFields`-adjacent
  // `priorYearEndValue` line — see the two tests below for that half.
  it("shows the Prior Dec 31 Balance field for an inherited IRA even though 'Subject to RMDs' is off", () => {
    renderForm(INHERITED);
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    expect(screen.getByLabelText("Prior Dec 31 Balance")).toBeTruthy();
  });

  // Fix round 1, finding 2: the VALUE was unpinned — this and the next test
  // pin the `(rmdEnabled || inheritedActive)` OR in each body builder's own
  // `priorYearEndValue: … ? priorYearEndValue : null` line. INHERITED has
  // `rmdEnabled: false`, so if either builder reverted to plain `rmdEnabled`,
  // a typed Year-1 balance override would silently become null on save.
  it("sends a typed prior Dec 31 balance for an inherited IRA via the submit path", async () => {
    renderForm(INHERITED);
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    fireEvent.change(screen.getByLabelText("Prior Dec 31 Balance"), { target: { value: "410000" } });
    fireEvent.submit(document.getElementById("add-account-form")!);
    const body = await putBody();
    expect(body.priorYearEndValue).toBe("410000");
  });

  it("sends a typed prior Dec 31 balance for an inherited IRA via the saveAsync path", async () => {
    const ref = createRef<AccountFormAutoSaveHandle>();
    renderForm(INHERITED, { ref });
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    fireEvent.change(screen.getByLabelText("Prior Dec 31 Balance"), { target: { value: "410000" } });
    await act(async () => { await ref.current!.saveAsync(); });
    const body = await putBody();
    expect(body.priorYearEndValue).toBe("410000");
  });

  // Pins the add-account-form-level WIRING from owners/familyMembers to
  // `inheritedUnavailableReason` (inherited-ira-fields.test.tsx only proves the
  // component renders correctly GIVEN that prop — this proves the form actually
  // computes it for a jointly-owned account, per spec: "owned 100% by one
  // household family member" is required to mark an IRA inherited).
  it("disables the checkbox with a reason for a jointly-owned IRA", () => {
    const JOINT: AccountFormInitial = {
      id: "acct-2", name: "Joint IRA", category: "retirement", subType: "traditional_ira",
      owner: "joint", value: "200000", basis: "0", growthRate: "0.07", rmdEnabled: true,
      owners: [
        { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
        { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
      ],
    };
    renderForm(JOINT);
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    const box = screen.getByLabelText("Inherited from someone other than a spouse") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/owned by the client or spouse/)).toBeTruthy();
  });
});
