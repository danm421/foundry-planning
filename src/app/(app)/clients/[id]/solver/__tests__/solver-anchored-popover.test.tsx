// @vitest-environment jsdom
//
// Focus return on close. The three Solve rows anchor their popover on a
// non-focusable wrapper <div> around the solve icon button, so "give focus back
// to the anchor" dropped it on <body> and a keyboard user lost their place
// after every solve. The shell now focuses the anchor when it can take focus,
// else its first focusable descendant.
import { useRef, useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SolverAnchoredPopover } from "../solver-anchored-popover";

function Host({ anchorIsWrapper }: { anchorIsWrapper: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <div ref={wrapperRef}>
        <button ref={buttonRef} type="button" onClick={() => setOpen(true)}>
          Solve
        </button>
      </div>
      {open && (
        <SolverAnchoredPopover
          anchor={anchorIsWrapper ? wrapperRef : buttonRef}
          label="Solve for"
          onClose={() => setOpen(false)}
        >
          <button type="button" onClick={() => setOpen(false)}>
            Apply
          </button>
        </SolverAnchoredPopover>
      )}
    </>
  );
}

describe("SolverAnchoredPopover — focus on close", () => {
  it.each([
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["a pick inside", () => fireEvent.click(screen.getByRole("button", { name: "Apply" }))],
  ])("a non-focusable wrapper anchor hands focus to its button (%s)", (_label, close) => {
    render(<Host anchorIsWrapper />);
    fireEvent.click(screen.getByRole("button", { name: "Solve" }));
    // Focus moved into the panel on open.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));

    act(() => close());

    expect(screen.queryByRole("dialog", { name: "Solve for" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Solve" }));
  });

  it("a focusable anchor still takes the focus itself", () => {
    render(<Host anchorIsWrapper={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Solve" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Solve" }));
  });
});
