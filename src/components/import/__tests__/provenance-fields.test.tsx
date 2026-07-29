// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { chipFor, FieldLabel } from "../provenance-fields";
import type { PlanBasicsField } from "@/lib/imports/assemble/types";

describe("chipFor", () => {
  it("admits an estimated field with a reason, carrying provenance through", () => {
    const field: PlanBasicsField<number> = {
      value: 41000,
      provenance: "estimated",
      reason: "Model estimate of UCSB cost.",
    };
    const chip = chipFor(field);
    expect(chip).toBeDefined();
    expect(chip?.provenance).toBe("estimated");
    expect(chip?.reason).toBe(field.reason);
  });

  it("rejects a document-sourced field even when it carries a reason", () => {
    const field: PlanBasicsField<number> = {
      value: 64,
      provenance: "document",
      reason: "Stated in the Profile table.",
    };
    expect(chipFor(field)).toBeUndefined();
  });

  it("rejects an estimated field with no reason", () => {
    const field: PlanBasicsField<number> = { value: 41000, provenance: "estimated" };
    expect(chipFor(field)).toBeUndefined();
  });
});

describe("FieldLabel", () => {
  it("renders a chip for an estimated field through the real composition path", () => {
    const field: PlanBasicsField<number> = {
      value: 41000,
      provenance: "estimated",
      reason: "Model estimate of UCSB cost.",
    };
    render(<FieldLabel id="edu-amount" label="Annual amount" field={field} />);
    const chip = screen.getByTestId("assumed-chip");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("data-provenance", "estimated");
  });

  it("renders no chip for a document-sourced field", () => {
    const field: PlanBasicsField<number> = {
      value: 64,
      provenance: "document",
      reason: "Stated in the Profile table.",
    };
    render(<FieldLabel id="age" label="Age" field={field} />);
    expect(screen.queryByTestId("assumed-chip")).not.toBeInTheDocument();
  });
});
