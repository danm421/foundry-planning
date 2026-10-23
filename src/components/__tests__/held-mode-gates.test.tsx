// @vitest-environment jsdom
import { createRef } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeldEditsProvider } from "@/hooks/held-edits";
import { usePlanSettingsAutosave } from "@/components/forms/use-plan-settings-autosave";
import AddNoteReceivableForm, {
  NOTES_SCENARIO_BLOCKED_MSG,
  type NoteReceivableFormAutoSaveHandle,
  type NoteReceivableFormInitial,
} from "@/components/forms/add-note-receivable-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/clients/c1/solver",
}));

const NOTE: NoteReceivableFormInitial = {
  id: "note-1",
  name: "Loan to Sam",
  faceValue: 50_000,
  basis: 50_000,
  interestRate: 0.05,
  paymentType: "amortizing",
  startYear: 2026,
  startMonth: 1,
  termMonths: 120,
  owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }],
  extraPayments: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("editors' own writes in hold mode", () => {
  it("autosave holds", async () => {
    const hold = vi.fn().mockResolvedValue(new Response("{}"));
    const { result } = renderHook(() => usePlanSettingsAutosave("c1"), {
      wrapper: ({ children }) => <HeldEditsProvider value={{ hold }}>{children}</HeldEditsProvider>,
    });
    act(() => result.current.save({ defaultGrowthTaxable: "0.06" }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(hold).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("note form blocked", async () => {
    const ref = createRef<NoteReceivableFormAutoSaveHandle>();
    render(
      <HeldEditsProvider value={{ hold: vi.fn() }}>
        <AddNoteReceivableForm ref={ref} clientId="c1" mode="edit" initial={NOTE} />
      </HeldEditsProvider>,
    );
    let res: Awaited<ReturnType<NoteReceivableFormAutoSaveHandle["saveAsync"]>> | undefined;
    await act(async () => {
      res = await ref.current!.saveAsync();
    });
    expect(res).toEqual({ ok: false, error: NOTES_SCENARIO_BLOCKED_MSG });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
