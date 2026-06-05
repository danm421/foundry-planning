// @vitest-environment jsdom
import { useMemo } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { IncomeStep } from "../income-step";
import { useLiftedList } from "@/lib/quick-start/use-lifted-list";
import type { IncomeRow } from "@/lib/quick-start/income-save";
import type { QsContext } from "@/lib/quick-start/derive";

function Mount({ hasSpouse }: { hasSpouse: boolean }) {
  const ctx = useMemo(
    () =>
      ({
        milestones: {} as QsContext["milestones"],
        planStartYear: 2026,
        planEndYear: 2066,
        clientFirstName: "John",
        spouseFirstName: hasSpouse ? "Jane" : null,
        hasSpouse,
      }) as QsContext,
    [hasSpouse],
  );
  const list = useLiftedList<IncomeRow>((makeId) => {
    const s: IncomeRow[] = [{ _id: makeId(), kind: "social_security", owner: "client" }];
    if (hasSpouse) s.push({ _id: makeId(), kind: "social_security", owner: "spouse" });
    return s;
  });
  return (
    <IncomeStep
      ctx={ctx}
      bootstrap={{ clientId: "c1" } as never}
      busy={false}
      registerSave={() => {}}
      list={list}
    />
  );
}

describe("IncomeStep", () => {
  it("pre-seeds a Social Security row per person", () => {
    render(<Mount hasSpouse />);
    expect(screen.getAllByText("Social Security")).toHaveLength(2);
    expect(screen.getByText(/John/)).toBeInTheDocument();
    expect(screen.getByText(/Jane/)).toBeInTheDocument();
  });

  it("single person seeds one SS row", () => {
    render(<Mount hasSpouse={false} />);
    expect(screen.getAllByText("Social Security")).toHaveLength(1);
  });

  it("Add income appends an editable salary row", async () => {
    const u = userEvent.setup();
    render(<Mount hasSpouse={false} />);
    await u.click(screen.getByRole("button", { name: "+ Add income" }));
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toBeInTheDocument();
  });
});
