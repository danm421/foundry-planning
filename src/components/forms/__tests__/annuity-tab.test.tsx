// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnnuityTab } from "../annuity-tab";

const noop = () => {};
const blank = {
  productType: "fixed" as const, taxTreatment: "non_qualified" as const,
  annualFeePct: 0, incomeMode: "none" as const, rollupRatchets: true,
};

describe("AnnuityTab", () => {
  it("warns when the cost basis is unset — correct LIFO is impossible without it", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={blank} onChange={noop} />);
    expect(screen.getByText(/cost basis/i)).toBeInTheDocument();
  });

  it("hides rider and annuitization fields while the mode is 'none'", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={blank} onChange={noop} />);
    expect(screen.queryByLabelText(/benefit base/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/annual payment/i)).not.toBeInTheDocument();
  });

  it("shows rider fields when the mode is 'rider'", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={{ ...blank, incomeMode: "rider" }} onChange={noop} />);
    expect(screen.getByLabelText(/benefit base/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/annual payment/i)).not.toBeInTheDocument();
  });

  it("shows annuitization fields when the mode is 'annuitized'", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={{ ...blank, incomeMode: "annuitized" }} onChange={noop} />);
    expect(screen.getByLabelText(/annual payment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/benefit base/i)).not.toBeInTheDocument();
  });

  it("warns that annuitizing is irreversible and zeroes the balance", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={{ ...blank, incomeMode: "annuitized" }} onChange={noop} />);
    expect(screen.getByText(/no longer have a cash value|irreversible/i)).toBeInTheDocument();
  });

  it("emits percentages as fractions, not whole numbers", async () => {
    const changes: unknown[] = [];
    render(<AnnuityTab accountId="a" clientId="c" value={{ ...blank, incomeMode: "rider", benefitBase: 100000 }}
      onChange={(v) => changes.push(v)} />);
    await userEvent.type(screen.getByLabelText(/roll-up rate/i), "6");
    expect(changes.at(-1)).toMatchObject({ rollupRate: 0.06 });
  });

  it("warns when a QLAC premium exceeds the 2026 cap", () => {
    render(<AnnuityTab accountId="a" clientId="c"
      value={{ ...blank, productType: "qlac" }} accountValue={250_000} onChange={noop} />);
    expect(screen.getByText(/210,000/)).toBeInTheDocument();
  });

  // ── Beyond the brief ────────────────────────────────────────────────────────
  // The first test above matches the *label* "Cost basis" as well as the
  // warning, so it passes whether or not the warning renders. These two pin the
  // warning itself, by copy only the warning carries.

  it("drops the cost-basis warning once a basis is entered", () => {
    const { rerender } = render(
      <AnnuityTab accountId="a" clientId="c" value={blank} onChange={noop} />,
    );
    expect(screen.getByText(/will look tax-free/i)).toBeInTheDocument();
    rerender(
      <AnnuityTab accountId="a" clientId="c" value={{ ...blank, costBasis: 80_000 }} onChange={noop} />,
    );
    expect(screen.queryByText(/will look tax-free/i)).not.toBeInTheDocument();
  });

  it("stays quiet about the QLAC cap when the premium is under it", () => {
    render(<AnnuityTab accountId="a" clientId="c"
      value={{ ...blank, productType: "qlac" }} accountValue={190_000} onChange={noop} />);
    expect(screen.queryByText(/210,000/)).not.toBeInTheDocument();
  });

  it("emits the mode the advisor picks", async () => {
    const changes: { incomeMode?: string }[] = [];
    render(<AnnuityTab accountId="a" clientId="c" value={blank}
      onChange={(v) => changes.push(v)} />);
    await userEvent.click(screen.getByRole("radio", { name: /income rider/i }));
    expect(changes.at(-1)?.incomeMode).toBe("rider");
  });
});
