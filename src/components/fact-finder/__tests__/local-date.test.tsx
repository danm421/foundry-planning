// @vitest-environment jsdom
// src/components/fact-finder/__tests__/local-date.test.tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { render, screen } from "@testing-library/react";
import { LocalDate } from "../local-date";

// Midday UTC, so the browser's own timezone still makes it October 8.
const ISO = "2026-10-08T12:00:00.000Z";

describe("LocalDate", () => {
  it("renders no date on the server — it can't know the browser's timezone", () => {
    expect(renderToString(<LocalDate iso={ISO} />)).toBe(`<time dateTime="${ISO}" class="tabular"></time>`);
  });

  it("shows the browser's date once hydrated, with no mismatch to hide", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<LocalDate iso={ISO} />);
    document.body.appendChild(host);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(host, <LocalDate iso={ISO} />, { onRecoverableError: (err) => errors.push(err) });
    });
    expect(host.textContent).toBe("October 8, 2026");
    expect(errors).toEqual([]);
    host.remove();
  });

  it("shows the date at once on a page rendered in the browser", () => {
    render(<LocalDate iso={ISO} />);
    expect(screen.getByText("October 8, 2026")).toHaveAttribute("dateTime", ISO);
  });
});
