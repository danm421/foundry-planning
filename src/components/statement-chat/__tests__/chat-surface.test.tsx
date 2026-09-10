// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSurface } from "../chat-surface";

const initialFiles = [{ serverFileId: "f1", name: "statement.pdf", documentType: "auto" }];

/** A real streaming Response whose body emits the given raw SSE frame strings. */
function makeFramedResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

/** The response ChatSurface's own mount-time hydration GET
 *  (`readImportPayloadJson`, Task 10b) expects — queued first in every
 *  test below so the SECOND fetch call is the one each test actually
 *  configures (the extraction POST, or the commit/finalize round trips in
 *  the tests further down this file). */
function importGetResponse(payloadJson: unknown = {}): Response {
  return new Response(JSON.stringify({ import: { payloadJson } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(fetch).mockResolvedValueOnce(importGetResponse());
});

describe("ChatSurface", () => {
  // C9 / IMPORTANT 3(a): a rate-limit (or any non-2xx) response must render
  // the server's own error copy, never leave the advisor staring at a
  // spinner that never resolves.
  it("renders the server's error copy for a non-2xx response, not a spinner", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Rate limiting is not configured — extraction is disabled." }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));

    expect(
      await screen.findByText("Rate limiting is not configured — extraction is disabled."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reading statements/i)).not.toBeInTheDocument();
  });

  // C9 / IMPORTANT 3(b): zero extracted accounts must render the plain
  // empty-state copy with a re-upload affordance, never an empty table.
  it("renders the empty-state copy — not a table — when done carries rows: []", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFramedResponse([
        `data: ${JSON.stringify({
          type: "done",
          summary: "Read 1 statement covering 0 accounts.",
          caveats: [],
          rows: [],
          excluded: [],
        })}\n\n`,
      ]),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));

    expect(await screen.findByText("No accounts found in these statements.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a real table when done carries rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFramedResponse([
        `data: ${JSON.stringify({
          type: "done",
          summary: "Read 1 statement covering 1 account.",
          caveats: [],
          rows: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
          excluded: [],
        })}\n\n`,
      ]),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("IRA")).toBeInTheDocument();
    expect(screen.queryByText("No accounts found in these statements.")).not.toBeInTheDocument();
  });
});

/** A "done" SSE frame carrying one kept row and (optionally) one excluded
 *  rollup row, matching the shape `chat/extract/route.ts` actually sends. */
function oneRowDoneFrame(opts?: { excluded?: boolean }): string {
  return `data: ${JSON.stringify({
    type: "done",
    summary: "Read 1 statement covering 1 account.",
    caveats: [],
    rows: [
      {
        name: "IRA",
        custodian: "Schwab",
        category: "taxable",
        subType: "brokerage",
        value: 100,
        __rowId: "r1",
      },
    ],
    excluded: opts?.excluded
      ? [
          {
            row: { name: "All Accounts", value: 300, __rowId: "r2" },
            decision: { kind: "rollup-excluded", label: "All Accounts", value: 300, coversCount: 1 },
          },
        ]
      : [],
  })}\n\n`;
}

async function renderAfterExtraction(opts?: { excluded?: boolean }) {
  vi.mocked(fetch).mockResolvedValueOnce(makeFramedResponse([oneRowDoneFrame(opts)]));
  render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
  fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));
  await screen.findByRole("table");
}

describe("ChatSurface — wiring the table in (Task 10b)", () => {
  // Ruling 38 / Task 7 C3: `rowIds` is honoured only by `commitAccounts`,
  // and is applied UNFILTERED to any other tab named in the same request —
  // so the posted body must always carry `tabs: ["accounts"]` alongside it.
  // A single-line mutation this catches: dropping `tabs` from the POST body,
  // or swapping in `rowIds: []`.
  it("posts tabs:['accounts'] alongside rowIds to the commit route", async () => {
    await renderAfterExtraction();
    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET before the payload.accounts PATCH
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // PATCH payload.accounts
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            payload: {
              accounts: [
                {
                  name: "IRA",
                  custodian: "Schwab",
                  category: "taxable",
                  subType: "brokerage",
                  value: 100,
                  __rowId: "r1",
                  match: { kind: "exact", existingId: "acct-1" },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ) // POST commit
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET before writeChatState
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })); // PATCH chat

    const row = screen.getByRole("row", { name: /IRA/ });
    await userEvent.click(within(row).getByRole("button", { name: /commit/i }));

    await screen.findByRole("button", { name: /committed/i });

    const commitCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes("/commit"));
    expect(commitCall).toBeDefined();
    const [, init] = commitCall!;
    expect(JSON.parse(init!.body as string)).toEqual({ tabs: ["accounts"], rowIds: ["r1"] });
  });

  it("locks the row after a successful commit (disabled Committed button)", async () => {
    await renderAfterExtraction();
    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET before the payload.accounts PATCH
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            payload: {
              accounts: [
                { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(importGetResponse({}))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const row = screen.getByRole("row", { name: /IRA/ });
    await userEvent.click(within(row).getByRole("button", { name: /commit/i }));

    expect(await within(row).findByRole("button", { name: /committed/i })).toBeDisabled();
  });

  it("edits a cell locally, then carries the edit into the next commit's payload PATCH", async () => {
    await renderAfterExtraction();
    const row = screen.getByRole("row", { name: /IRA/ });
    // "Account type" is the one editable column (accounts-columns.ts).
    await userEvent.click(within(row).getByRole("button", { name: /Taxable · Brokerage/i }));
    await userEvent.selectOptions(screen.getByLabelText("Category"), "retirement");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "roth_ira");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // The local edit is reflected immediately.
    expect(within(row).getByText(/Retirement · Roth IRA/i)).toBeInTheDocument();

    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET before the payload.accounts PATCH
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // PATCH payload.accounts
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            payload: {
              accounts: [
                {
                  name: "IRA",
                  custodian: "Schwab",
                  category: "retirement",
                  subType: "roth_ira",
                  value: 100,
                  __rowId: "r1",
                  match: { kind: "exact", existingId: "acct-1" },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(importGetResponse({}))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await userEvent.click(within(row).getByRole("button", { name: /commit/i }));
    await screen.findByRole("button", { name: /committed/i });

    const patchCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) => String(url).endsWith("/imports/i1") && init?.method === "PATCH",
      );
    expect(patchCall).toBeDefined();
    const [, init] = patchCall!;
    const body = JSON.parse(init!.body as string);
    expect(body.payloadJson.payload.accounts[0]).toMatchObject({
      category: "retirement",
      subType: "roth_ira",
    });
  });

  it("restores an excluded rollup row into the working table without committing it", async () => {
    await renderAfterExtraction({ excluded: true });

    expect(screen.getByText(/total covering 1 account/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /include anyway/i }));

    // Now in the working table, with its own Commit button — not fired.
    const restoredRow = screen.getByRole("row", { name: /All Accounts/ });
    expect(within(restoredRow).getByRole("button", { name: /^commit$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /include anyway/i })).not.toBeInTheDocument();
  });

  it("closes the import via Finish import and shows the closed state", async () => {
    await renderAfterExtraction();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, status: "committed" }), { status: 200 }));

    await userEvent.click(screen.getByRole("button", { name: /finish import/i }));

    expect(await screen.findByText("Import closed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finish import/i })).not.toBeInTheDocument();
  });

  // THE test that matters for this surface's half of Ruling 70: a premature
  // finalize's 409 must render as readable copy, not a dead button or a
  // false "closed" state.
  it("shows the server's 409 as readable copy when finalize is premature", async () => {
    await renderAfterExtraction();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "1 account row still needs to be committed before this import can be closed." }),
        { status: 409 },
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: /finish import/i }));

    expect(
      await screen.findByText("1 account row still needs to be committed before this import can be closed."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Import closed.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finish import/i })).toBeInTheDocument();
  });

  it("disables Finish import only while a close is in flight, not on an uncommitted row", async () => {
    await renderAfterExtraction();
    // Deliberately NOT committed first — Ruling 70 puts the "is everything
    // really committed?" check on the server, not a client precondition, so
    // the button stays clickable and the server's 409 does the talking.
    expect(screen.getByRole("button", { name: /finish import/i })).toBeEnabled();
  });
});

describe("ChatSurface — committedRowIds mount hydration (round 1 review, Important 3)", () => {
  // Every OTHER test in this file queues `importGetResponse()` with an
  // EMPTY payloadJson for the mount-hydration GET, so none of them can
  // catch a broken hydration read — deleting the line that wires it up
  // reddens nothing there. This is the one test with a real value in that
  // response.
  it("hydrates committedRowIds from the persisted chat state on mount, locking the row before any commit happens", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({ chat: { committedRowIds: ["r1"] } })) // mount GET
      .mockResolvedValueOnce(makeFramedResponse([oneRowDoneFrame()])); // extraction POST

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));

    const row = await screen.findByRole("row", { name: /IRA/ });
    expect(await within(row).findByRole("button", { name: /committed/i })).toBeDisabled();
  });
});

describe("ChatSurface — payload.accounts must never regress a linked row (round 1 review, Important 1)", () => {
  // Sequence 1 named in the review: "the ordinary resume." After a reload,
  // the table only renders once a (re-)extraction has run, and
  // `mergeAcrossFiles` re-emits EVERY row as `{kind: "new"}` — it has no
  // memory of what an earlier session committed. Committing a DIFFERENT,
  // not-yet-committed row must not carry that fresh "new" r1 into the
  // PATCH and overwrite the `{kind: "exact"}` the server already has for
  // it.
  it("preserves an already-linked row's server match when a different row is committed after a resume", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        importGetResponse({
          chat: { committedRowIds: ["r1"] },
          payload: {
            accounts: [
              {
                name: "IRA",
                custodian: "Schwab",
                value: 100,
                __rowId: "r1",
                match: { kind: "exact", existingId: "acct-1" },
              },
            ],
          },
        }),
      ) // mount GET — r1 was already committed in an earlier session
      .mockResolvedValueOnce(
        makeFramedResponse([
          `data: ${JSON.stringify({
            type: "done",
            summary: "Read 1 statement covering 2 accounts.",
            caveats: [],
            rows: [
              { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" },
              { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2" },
            ],
            excluded: [],
          })}\n\n`,
        ]),
      ); // extraction POST — re-merged fresh, BOTH rows show as "new"

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));
    await screen.findByRole("table");

    // r1 renders locked purely from the committedRowIds hydration, even
    // though the fresh merge it rode in on shows it as "new".
    const r1Row = screen.getByRole("row", { name: /IRA/ });
    expect(await within(r1Row).findByRole("button", { name: /committed/i })).toBeDisabled();

    // Commit r2. The fix's pre-commit fresh read must see r1's PERSISTED
    // exact link and carry it through, not the locally-remerged "new" r1.
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        importGetResponse({
          payload: {
            accounts: [
              {
                name: "IRA",
                custodian: "Schwab",
                value: 100,
                __rowId: "r1",
                match: { kind: "exact", existingId: "acct-1" },
              },
            ],
          },
        }),
      ) // fresh GET before the payload.accounts PATCH
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // PATCH payload.accounts
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            payload: {
              accounts: [
                { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
                { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2", match: { kind: "exact", existingId: "acct-2" } },
              ],
            },
          }),
          { status: 200 },
        ),
      ) // POST commit
      .mockResolvedValueOnce(importGetResponse({ chat: { committedRowIds: ["r1"] } })) // fresh GET for chat
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })); // PATCH chat

    const r2Row = screen.getByRole("row", { name: /Brokerage/ });
    await userEvent.click(within(r2Row).getByRole("button", { name: /commit/i }));
    await within(r2Row).findByRole("button", { name: /committed/i });

    const payloadPatchCall = vi.mocked(fetch).mock.calls.find(([url, init]) => {
      if (!String(url).endsWith("/imports/i1") || init?.method !== "PATCH") return false;
      const body = JSON.parse(init.body as string);
      return Boolean(body.payloadJson?.payload);
    });
    expect(payloadPatchCall).toBeDefined();
    const [, init] = payloadPatchCall!;
    const accounts = JSON.parse(init!.body as string).payloadJson.payload.accounts as Array<{
      __rowId: string;
      match?: { kind: string; existingId?: string };
    }>;
    const r1Entry = accounts.find((a) => a.__rowId === "r1");
    expect(r1Entry?.match).toEqual({ kind: "exact", existingId: "acct-1" });
  });

  // Sequence 2 named in the review: "two quick clicks on different rows."
  // `pending` is keyed per rowId (entity-table.tsx), so nothing at the
  // table layer stops row 2's commit from starting before row 1's has
  // finished persisting its link. Firing both without awaiting between
  // them and inspecting the LAST payload.accounts PATCH proves the two
  // commits ran one at a time rather than interleaved — row 2's PATCH can
  // only show row 1 as already `exact` if row 2's own pre-commit read
  // happened AFTER row 1's write had fully landed.
  it("does not let two commits for different rows race and regress each other's link", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({})) // mount GET
      .mockResolvedValueOnce(
        makeFramedResponse([
          `data: ${JSON.stringify({
            type: "done",
            summary: "Read 1 statement covering 2 accounts.",
            caveats: [],
            rows: [
              { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" },
              { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2" },
            ],
            excluded: [],
          })}\n\n`,
        ]),
      ); // extraction POST

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));
    await screen.findByRole("table");

    // Row 1's full commit chain — queued as if it runs to completion before
    // row 2's begins (the invariant this test is checking).
    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({})) // r1 fresh GET — nothing persisted yet
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // r1 PATCH payload.accounts
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            payload: {
              accounts: [
                { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
                { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2" },
              ],
            },
          }),
          { status: 200 },
        ),
      ) // r1 POST commit
      .mockResolvedValueOnce(importGetResponse({})) // r1 fresh GET for chat
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // r1 PATCH chat
      // Row 2's chain — its fresh read must land AFTER row 1's above, so it
      // sees row 1 already linked.
      .mockResolvedValueOnce(
        importGetResponse({
          payload: {
            accounts: [
              { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
            ],
          },
        }),
      ) // r2 fresh GET
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // r2 PATCH payload.accounts
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            payload: {
              accounts: [
                { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
                { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2", match: { kind: "exact", existingId: "acct-2" } },
              ],
            },
          }),
          { status: 200 },
        ),
      ) // r2 POST commit
      .mockResolvedValueOnce(importGetResponse({ chat: { committedRowIds: ["r1"] } })) // r2 fresh GET for chat
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })); // r2 PATCH chat

    const r1Row = screen.getByRole("row", { name: /IRA/ });
    const r2Row = screen.getByRole("row", { name: /Brokerage/ });

    // Fire both without awaiting the first's full chain — `userEvent.click`
    // resolves once the (fire-and-forget) click handler has been invoked,
    // not once the async commit it kicks off has settled.
    const click1 = userEvent.click(within(r1Row).getByRole("button", { name: /^commit$/i }));
    const click2 = userEvent.click(within(r2Row).getByRole("button", { name: /^commit$/i }));
    await Promise.all([click1, click2]);

    await within(r1Row).findByRole("button", { name: /committed/i });
    await within(r2Row).findByRole("button", { name: /committed/i });

    const payloadPatchCalls = vi.mocked(fetch).mock.calls.filter(([url, init]) => {
      if (!String(url).endsWith("/imports/i1") || init?.method !== "PATCH") return false;
      const body = JSON.parse(init.body as string);
      return Boolean(body.payloadJson?.payload);
    });
    // The LAST payload.accounts PATCH is row 2's own — it must show row 1
    // still linked, proving row 2's pre-commit read happened after row 1's
    // write landed rather than racing it.
    const lastPatch = payloadPatchCalls.at(-1)!;
    const accounts = JSON.parse(lastPatch[1]!.body as string).payloadJson.payload.accounts as Array<{
      __rowId: string;
      match?: { kind: string; existingId?: string };
    }>;
    const r1Entry = accounts.find((a) => a.__rowId === "r1");
    expect(r1Entry?.match).toEqual({ kind: "exact", existingId: "acct-1" });
  });
});
