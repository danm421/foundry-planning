// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import MatchLinkPicker, { type MatchEntityKind } from "../match-link-picker";

function renderPicker(entityKind: MatchEntityKind | undefined) {
  const anchor = document.body.appendChild(document.createElement("button"));
  render(
    <MatchLinkPicker
      anchorRef={{ current: anchor }}
      currentMatch={undefined}
      candidates={[]}
      entityKind={entityKind}
      onPick={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("MatchLinkPicker wording", () => {
  // The fact finder links records the picker has no noun for (a gift, a note
  // receivable), so it opens the picker with no entityKind at all.
  it.each([
    ["a kind it knows", "lifePolicy", "policy", "policies"],
    ["no kind", undefined, "record", "records"],
  ] as const)("names the rows for %s", (_name, entityKind, one, many) => {
    renderPicker(entityKind);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(`Link to an existing ${one}`);
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", `Search existing ${many}…`);
    expect(screen.getByText(`No existing ${many} to link.`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Create as new ${one}` })).toBeInTheDocument();
  });
});
