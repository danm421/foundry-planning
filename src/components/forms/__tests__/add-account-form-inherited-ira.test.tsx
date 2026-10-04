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
    renderForm(JOINT, { ownerNames: { clientName: "Alice", spouseName: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    const box = screen.getByLabelText("Inherited from someone other than a spouse") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/owned by Alice or Bob/)).toBeTruthy();
  });

  // A ticked IRA re-owned to a child or a trust must not save as inherited:
  // the engine ignores the fields for an entity (and, with "Subject to RMDs"
  // hidden, takes no RMDs at all), and would use the CLIENT's birth year for a
  // child. The fields stay as typed — the advisor unticks or changes the owner.
  it.each([
    ["a child", [{ kind: "family_member" as const, familyMemberId: "fm-child", percent: 1 }]],
    ["a trust", [{ kind: "entity" as const, entityId: "trust-1", percent: 1 }]],
  ])("blocks saving a ticked IRA owned by %s", async (_, owners) => {
    const onAutoSaveStateChange = vi.fn();
    renderForm({ ...INHERITED, owners }, {
      onAutoSaveStateChange,
      familyMembers: [...FAMILY, { id: "fm-child", role: "child", firstName: "Cara" }],
      entities: [{ id: "trust-1", name: "Family Trust" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    await waitFor(() => expect(onAutoSaveStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ canSave: false })));
    expect(screen.getByRole("alert").textContent).toBe(
      "Only an IRA owned by the client or co-client can be inherited — untick the box or change the owner back.",
    );
    expect((screen.getByLabelText("Inherited from someone other than a spouse") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Year of death") as HTMLInputElement).value).toBe("2022");
  });

  it("uses the SPOUSE's birth year as the heir's for a spouse-owned inherited IRA", () => {
    // Owner born 1945. The spouse (1950) is 5 years younger → stretch; the
    // client (1975) is 30 years younger → 10-year rule. Spouse heir LE:
    // SLT[73] 16.4 in 2023 → 13.4 in 2026 (beats the owner's 13.3 − 4 = 9.3).
    renderForm(
      { ...INHERITED, owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }] },
      { milestones: { ...MILESTONES, spouseBirthYear: 1950 } },
    );
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    const summary = screen.getByTestId("inherited-rule-summary").textContent!;
    expect(summary).toContain("Stretch — yearly RMDs over life expectancy because the heir is no more than 10 years younger");
    expect(summary).toContain("Divisor 13.4 in 2026");
    expect(summary).not.toContain("10-year rule");
  });
});

describe("AddAccountForm — inherited IRA payout plan", () => {
  // INHERITED: death 2022, owner born 1945, heir = client born 1975 → deadline 2032.
  const WITH_WINDOW: AccountFormInitial = { ...INHERITED, inheritedPayoutFromYear: 2028, inheritedPayoutThroughYear: 2032 };

  it("round-trips a saved window through the submit path", async () => {
    renderForm(WITH_WINDOW);
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    expect((screen.getByLabelText("Spread payouts evenly") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2028");
    fireEvent.submit(document.getElementById("add-account-form")!);
    expect(await putBody()).toMatchObject({ inheritedPayoutFromYear: 2028, inheritedPayoutThroughYear: 2032 });
  });

  it("choosing 'Minimum each year' sends nulls", async () => {
    renderForm(WITH_WINDOW);
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    fireEvent.click(screen.getByLabelText("Minimum each year"));
    fireEvent.submit(document.getElementById("add-account-form")!);
    expect(await putBody()).toMatchObject({ inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null });
  });

  it("unticking 'Inherited' clears the window via the autosave path", async () => {
    const ref = createRef<AccountFormAutoSaveHandle>();
    renderForm(WITH_WINDOW, { ref });
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    fireEvent.click(screen.getByLabelText("Inherited from someone other than a spouse"));
    await act(async () => { await ref.current!.saveAsync(); });
    expect(await putBody()).toMatchObject({ inheritedDeathYear: null, inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null });
  });

  it("picking the window pre-fills it, and the autosave path sends it", async () => {
    const ref = createRef<AccountFormAutoSaveHandle>();
    renderForm(INHERITED, { ref });
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    fireEvent.click(screen.getByLabelText("Spread payouts evenly"));
    await act(async () => { await ref.current!.saveAsync(); });
    expect(await putBody()).toMatchObject({ inheritedPayoutFromYear: 2026, inheritedPayoutThroughYear: 2032 });
  });

  it("blocks saving a last year after the 10-year deadline, with the message under the window", async () => {
    const onAutoSaveStateChange = vi.fn();
    renderForm({ ...WITH_WINDOW, inheritedPayoutThroughYear: 2033 }, { onAutoSaveStateChange });
    fireEvent.click(screen.getByRole("button", { name: "RMD" }));
    await waitFor(() => expect(onAutoSaveStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ canSave: false })));
    expect(screen.getByRole("alert").textContent).toContain("empties this account by 2032");
    // The inputs that fix it are still on screen.
    expect(screen.getByLabelText("Through")).toBeTruthy();
  });
});
