// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import TrustEndsSelect from "../trust-ends-select";
import { describe, it, expect, vi } from "vitest";

describe("TrustEndsSelect", () => {
  const household = { client: { firstName: "John" }, spouse: { firstName: "Jane" } };

  it("renders three options labeled with names + survivorship", () => {
    render(<TrustEndsSelect household={household} value={null} onChange={() => {}} />);
    expect(screen.getByRole("option", { name: /john's death/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /jane's death/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /survivorship/i })).toBeInTheDocument();
  });

  it("calls onChange with the enum value on selection", () => {
    const onChange = vi.fn();
    render(<TrustEndsSelect household={household} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "spouse_death" } });
    expect(onChange).toHaveBeenCalledWith("spouse_death");
  });

  it("hides spouse option when no spouse in household", () => {
    render(<TrustEndsSelect household={{ client: { firstName: "John" }, spouse: null }} value={null} onChange={() => {}} />);
    // Spouse option should not be present; the four options become: blank, client_death, survivorship.
    expect(screen.queryByRole("option", { name: /jane's death/i })).not.toBeInTheDocument();
    // Verify exact remaining options exist
    expect(screen.getByRole("option", { name: /john's death/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /survivorship/i })).toBeInTheDocument();
  });
});
