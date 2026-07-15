// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportCustomizePopover } from "../report-customize-popover";
import {
  REPORT_KEYS,
  resolveReportLayout,
  type ReportKey,
} from "@/lib/solver/report-layout";

const Dot = () => <svg />;
const meta = Object.fromEntries(
  REPORT_KEYS.map((id) => [id, { label: id, short: id, icon: Dot }]),
) as Record<ReportKey, { label: string; short: string; icon: typeof Dot }>;

function setup(overrides?: {
  layout?: ReturnType<typeof resolveReportLayout>;
  onChange?: (n: ReturnType<typeof resolveReportLayout>) => void;
}) {
  const onChange = overrides?.onChange ?? vi.fn();
  const layout = overrides?.layout ?? resolveReportLayout(null);
  render(
    <ReportCustomizePopover
      layout={layout}
      meta={meta}
      onChange={onChange}
      onClose={() => undefined}
    />,
  );
  return { onChange };
}

describe("ReportCustomizePopover", () => {
  it("renders a row per report with its label", () => {
    setup();
    for (const id of REPORT_KEYS) {
      expect(screen.getByText(id)).toBeInTheDocument();
    }
  });

  it("toggling a visible report off calls onChange with it hidden", async () => {
    const onChange = vi.fn();
    setup({ onChange });
    await userEvent.click(
      screen.getByRole("switch", { name: /portfolio/i }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.find((e: { id: string }) => e.id === "portfolio").visible).toBe(
      false,
    );
  });

  it("disables hiding the last remaining visible report", async () => {
    // Only 'estate' visible.
    const layout = resolveReportLayout(
      REPORT_KEYS.map((id) => ({ id, visible: id === "estate" })),
    );
    const onChange = vi.fn();
    setup({ layout, onChange });
    const estateSwitch = screen.getByRole("switch", { name: /estate/i });
    expect(estateSwitch).toBeDisabled();
    await userEvent.click(estateSwitch);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Reset restores canonical order, all visible", async () => {
    const layout = resolveReportLayout([
      { id: "monteCarlo", visible: false },
      { id: "portfolio", visible: true },
    ]);
    const onChange = vi.fn();
    setup({ layout, onChange });
    await userEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(onChange).toHaveBeenCalledWith(resolveReportLayout(null));
  });
});
