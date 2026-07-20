// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import UpdateRowBody from "@/components/activity/update-row-body";
import type { FieldChange } from "@/lib/audit";

describe("UpdateRowBody", () => {
  it("renders a normal change as from → to", () => {
    const changes: FieldChange[] = [
      { field: "email", label: "Email", from: "a@x.com", to: "b@x.com", format: "text" },
    ];
    render(<UpdateRowBody changes={changes} />);
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    expect(screen.getByText("b@x.com")).toBeInTheDocument();
  });

  it("renders a redacted change as 'updated' and leaks no value", () => {
    const changes: FieldChange[] = [
      {
        field: "ssnLast4",
        label: "SSN last 4",
        from: null,
        to: null,
        format: "text",
        redacted: true,
      },
    ];
    const { container } = render(<UpdateRowBody changes={changes} />);
    expect(screen.getByText("updated")).toBeInTheDocument();
    expect(container.textContent).not.toContain("→");
  });
});
