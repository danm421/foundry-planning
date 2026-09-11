// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MedicareSetupDialog } from "@/components/medicare/medicare-setup-dialog";

describe("MedicareSetupDialog", () => {
  it("shows a Client/Co-client owner switch only when hasSpouse is true", () => {
    const dobsNoSpouse = {
      client: "1958-01-01",
      spouse: null,
    };
    const dobsWithSpouse = {
      client: "1958-01-01",
      spouse: "1959-01-01",
    };
    const { rerender } = render(
      <MedicareSetupDialog clientId="c1" ownerDobs={dobsNoSpouse}
        hasSpouse={false} onClose={() => {}} onSaved={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /co-client/i })).not.toBeInTheDocument();
    rerender(
      <MedicareSetupDialog clientId="c1" ownerDobs={dobsWithSpouse}
        hasSpouse onClose={() => {}} onSaved={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /co-client/i })).toBeInTheDocument();
  });
});
