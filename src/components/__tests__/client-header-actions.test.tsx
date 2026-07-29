// @vitest-environment jsdom
/**
 * <ClientHeaderActions> re-parents a route's action buttons into the client
 * header row. Both branches matter and neither is visible from the callers'
 * own tests, which only ever see the fallback:
 *
 *  - host present  → children land INSIDE the header slot (the whole point of
 *                    the component; a silent miss would put the solver's save
 *                    buttons back at the bottom of the workspace).
 *  - host absent   → children still render, in place, so a page rendered in
 *                    isolation under test doesn't lose its actions entirely.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  ClientHeaderActions,
  CLIENT_HEADER_ACTIONS_ID,
} from "@/components/client-header-actions";

afterEach(() => {
  cleanup();
  document.getElementById(CLIENT_HEADER_ACTIONS_ID)?.remove();
});

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  host.id = CLIENT_HEADER_ACTIONS_ID;
  document.body.appendChild(host);
  return host;
}

describe("ClientHeaderActions", () => {
  it("portals children into the header slot when the host exists", () => {
    const host = mountHost();

    const { container } = render(
      <ClientHeaderActions>
        <button type="button">Save as scenario…</button>
      </ClientHeaderActions>,
    );

    const btn = screen.getByRole("button", { name: "Save as scenario…" });
    // In the header slot...
    expect(host.contains(btn)).toBe(true);
    // ...and NOT left behind in the caller's own layout position. Without this
    // the first assertion would also pass for a component that simply renders
    // in place while a host happens to be mounted elsewhere.
    expect(container.contains(btn)).toBe(false);
  });

  it("falls back to rendering in place when no host is mounted", () => {
    const { container } = render(
      <ClientHeaderActions>
        <button type="button">Save as scenario…</button>
      </ClientHeaderActions>,
    );

    const btn = screen.getByRole("button", { name: "Save as scenario…" });
    expect(container.contains(btn)).toBe(true);
  });
});
