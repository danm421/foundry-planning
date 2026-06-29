// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MedicareSetupDialog } from "@/components/medicare/medicare-setup-dialog";

describe("MedicareSetupDialog", () => {
  it("shows a Client/Spouse owner switch only when hasSpouse is true", () => {
    const { rerender } = render(
      <MedicareSetupDialog clientId="c1" ownerDobs={{ client: "1958-01-01", spouse: null }}
        hasSpouse={false} onClose={() => {}} onSaved={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /spouse/i })).not.toBeInTheDocument();
    rerender(
      <MedicareSetupDialog clientId="c1" ownerDobs={{ client: "1958-01-01", spouse: "1959-01-01" }}
        hasSpouse onClose={() => {}} onSaved={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /spouse/i })).toBeInTheDocument();
  });
});
