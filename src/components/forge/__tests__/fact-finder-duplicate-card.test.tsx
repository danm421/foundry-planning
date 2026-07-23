// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FactFinderDuplicateCard } from "../fact-finder-duplicate-card";

describe("FactFinderDuplicateCard", () => {
  const candidates = [{ householdId: "h1", clientId: "c1", name: "Martin", status: "active" }];

  it("renders each option and fires the right callback", () => {
    const onUpdate = vi.fn(), onCreate = vi.fn(), onCancel = vi.fn();
    render(
      <FactFinderDuplicateCard
        householdName="Martin"
        candidates={candidates}
        onUpdate={onUpdate}
        onCreateSeparate={onCreate}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /update .*plan/i }));
    expect(onUpdate).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByRole("button", { name: /separate/i }));
    expect(onCreate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
