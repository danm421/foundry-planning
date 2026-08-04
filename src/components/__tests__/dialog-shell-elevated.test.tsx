// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DialogShell from "../dialog-shell";

function open(props: { elevated?: boolean }) {
  render(
    <DialogShell open onOpenChange={() => {}} title="T" {...props}>
      <p>body</p>
    </DialogShell>,
  );
  return screen.getByTestId("dialog-overlay").parentElement!;
}

describe("DialogShell elevation", () => {
  it("defaults to z-50 so existing dialogs are unchanged", () => {
    expect(open({}).className).toContain("z-50");
  });

  it("does not apply the elevated layer by default", () => {
    expect(open({}).className).not.toContain("z-[85]");
  });

  it("renders above the walkthrough scrim when elevated", () => {
    const root = open({ elevated: true });
    expect(root.className).toContain("z-[85]");
    expect(root.className).not.toContain("z-50");
  });
});
