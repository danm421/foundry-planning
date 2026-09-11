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

  // Sequence 2 named in the review ("two quick clicks on different rows")
  // is deliberately NOT tested here. A component-level version driven
  // through `userEvent.click` used to live in this spot; round 2 review
  // confirmed it stayed green with EITHER the fresh-read merge OR the
  // commit queue removed — `userEvent.click`'s own internal awaiting
  // serializes two "simultaneous" clicks regardless of whether the hook
  // itself does, so it proved nothing sequence 1's resume test didn't
  // already cover. The real proof of serialization is the hook-level test
  // in `use-chat-commit.test.tsx`, which forces genuine overlap with a
  // manually-gated fetch rather than relying on `userEvent`'s timing.
});

// --- Task 11b: the chat itself ---------------------------------------------

/** A "done" turn response, matching the shape `chat/turn/route.ts` sends
 *  after C1 (Ruling 90) added `turnEntries`. */
function turnResponse(overrides: {
  accounts: Array<Record<string, unknown>>;
  summary: string;
  turnEntries: Array<Record<string, unknown>>;
  excludedRows?: unknown[];
}): Response {
  return new Response(
    JSON.stringify({
      payload: { accounts: overrides.accounts },
      summary: overrides.summary,
      excludedRows: overrides.excludedRows ?? [],
      turnEntries: overrides.turnEntries,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const composerTextbox = () => screen.getByRole("textbox", { name: /ask a follow-up question/i });
const sendButton = () => screen.getByRole("button", { name: /^send$/i });

/** Queues the two fetch calls `flushRowsToServer` makes (Ruling 95/100) —
 *  ALWAYS the first two calls of any `sendTurn`, before the turn's own
 *  POST: one fresh GET, then one PATCH carrying BOTH `payload.accounts` and
 *  `chat.excludedRows`. Every test below that sends a turn queues these
 *  first, or its "turn response" mock is consumed by the flush's own GET
 *  instead.
 *
 *  `standing` is the `payloadJson` the fresh GET returns — what the flush
 *  reads BEFORE it writes. Defaults to `{}` (nothing excluded, nothing to
 *  strip) for the common case; a test exercising the restore-clears-
 *  excludedRows path must pass a `chat.excludedRows` that actually
 *  contains the row being restored, or the flush's filter has nothing to
 *  prove — the exact unfaithful-mock shape flagged in re-review round 1. */
function mockFlush(standing: unknown = {}) {
  vi.mocked(fetch)
    .mockResolvedValueOnce(importGetResponse(standing)) // flush: fresh GET
    .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })); // flush: PATCH payload+chat
}

describe("ChatSurface — composer and transcript render outside the finished-and-result gate (C3)", () => {
  // THE test that matters for C3: a resumed draft with no extraction run
  // in THIS session never flips `status` away from "idle", so `finished`
  // stays false and `result` stays null for the entire session unless a
  // turn lands. Mutation this catches: moving the Chat card's JSX back
  // inside `{finished && result && (...)}` — both assertions below would
  // then find nothing, since that block never renders here.
  it("renders the transcript and composer for a resumed draft with no extraction run this session", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValueOnce(
      importGetResponse({
        chat: {
          transcript: [
            { role: "user", text: "what's the basis on the IRA?", at: "t0" },
            { role: "assistant", text: "It's $5,000.", at: "t0" },
          ],
        },
      }),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={[]} />);

    expect(await screen.findByText("what's the basis on the IRA?")).toBeInTheDocument();
    expect(screen.getByText("It's $5,000.")).toBeInTheDocument();
    expect(composerTextbox()).toBeInTheDocument();
    expect(sendButton()).toBeInTheDocument();
    // Nothing from the extracted-state panel is showing — this is purely
    // the chat surface having something to show BEFORE any extraction.
    // (I2 keeps this true: hydration populates the table only when the
    // persisted payload actually HAS rows, and this fixture has none.)
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("ChatSurface — a resumed draft renders its persisted rows (I2)", () => {
  // The reviewed defect: `use-chat-commit`'s mount GET already returned
  // `payload.accounts` and threw them away, and the table was additionally
  // gated on this session's stream `status` — so resuming a draft showed a
  // transcript and a composer above an empty space, which the browser pass
  // recorded as reading like "did this lose my work?".
  //
  // Mutation this catches: reverting either half — dropping the hydration
  // (no rows to render) or restoring the `finished &&` gate (`status` is
  // "idle" here for the whole test, so the panel never appears).
  it("renders the persisted table, its excluded rows, and the committed lock, with no extraction this session", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue(
      importGetResponse({
        payload: {
          accounts: [
            { __rowId: "r1", name: "Fidelity IRA", value: 450_000, category: "retirement" },
            { __rowId: "r2", name: "Joint Brokerage", value: 120_000, category: "taxable" },
          ],
        },
        chat: {
          surface: "chat",
          transcript: [{ role: "assistant", text: "Two accounts found.", at: "t0" }],
          decisions: [],
          excludedRows: [{ row: { __rowId: "r9", name: "Total Portfolio" }, reason: "a printed total" }],
          committedRowIds: ["r1"],
        },
      }),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={[]} />);

    // The rows are on screen…
    expect(await screen.findByText("Fidelity IRA")).toBeInTheDocument();
    expect(screen.getByText("Joint Brokerage")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    // …the excluded row is still shown as excluded…
    expect(screen.getByText("Total Portfolio")).toBeInTheDocument();
    // …and the row committed in the EARLIER session is locked, not offered
    // for a second commit.
    expect(screen.getByRole("button", { name: "Committed" })).toBeDisabled();
    // The panel that only appears with a table is here too.
    expect(screen.getByRole("button", { name: "Finish import" })).toBeInTheDocument();
  });

  // The other half: an import nobody has extracted yet must still render
  // nothing rather than "No accounts found in these statements" — that copy
  // is a claim about statements no one has read.
  it("renders no extracted-state panel at all for an import with nothing persisted", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue(importGetResponse({}));

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);

    expect(await screen.findByText("1 file ready.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/No accounts found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish import" })).not.toBeInTheDocument();
  });
});

describe("ChatSurface — the transcript renders what the route returned, never a locally composed string (C1)", () => {
  it("appends the server's turnEntries verbatim, not the advisor's own typed text", async () => {
    await renderAfterExtraction();

    mockFlush();
    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        summary: "server summary",
        turnEntries: [
          { role: "user", text: "SERVER-ECHOED TEXT", at: "t1" },
          { role: "tool", tool: "explain", summary: "Cited page 2.", at: "t1" },
          { role: "assistant", text: "server summary", at: "t1" },
        ],
      }),
    );

    await userEvent.type(composerTextbox(), "what I actually typed");
    await userEvent.click(sendButton());

    // The rendered user entry is the SERVER's text, not the local input —
    // mutation this catches: `use-chat-turn.ts` synthesizing
    // `{ role: "user", text: message, at: now }` client-side instead of
    // using `body.turnEntries`.
    expect(await screen.findByText("SERVER-ECHOED TEXT")).toBeInTheDocument();
    expect(screen.queryByText("what I actually typed")).not.toBeInTheDocument();
    expect(screen.getByText(/Cited page 2\./)).toBeInTheDocument();
    expect(screen.getByText("server summary")).toBeInTheDocument();
  });
});

describe("ChatSurface — a chat turn's row edit must survive into the next commit (Step 2, THE test that matters)", () => {
  // Task 10b's `handleCommitRows` PATCHes `payload.accounts` wholesale from
  // its OWN React row state before every commit. A tool that edits a row
  // SERVER-SIDE is silently overwritten by that PATCH unless this surface
  // adopts the turn's returned payload into its row state first. Mutation
  // this catches: removing (or no-op-ing) the `await adoptTurnPayload(...)`
  // call in `use-chat-turn.ts` — the commit's PATCH would then carry the
  // PRE-turn value (100), not the tool's edit (999).
  it("adopts a turn's row edit before any subsequent commit's PATCH, carrying the tool's edit not the pre-turn value", async () => {
    await renderAfterExtraction(); // r1 "IRA" value=100

    mockFlush();
    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [
          {
            name: "IRA",
            custodian: "Schwab",
            category: "taxable",
            subType: "brokerage",
            value: 999,
            __rowId: "r1",
          },
        ],
        summary: "Updated the value to $999.",
        turnEntries: [
          { role: "user", text: "fix the value", at: "t1" },
          { role: "tool", tool: "edit_row", summary: "Set value to 999.", at: "t1" },
          { role: "assistant", text: "Updated the value to $999.", at: "t1" },
        ],
      }),
    );

    await userEvent.type(composerTextbox(), "fix the value");
    await userEvent.click(sendButton());
    await screen.findByText("Updated the value to $999.");

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
                  value: 999,
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

    // .filter(...).at(-1), not .find(...): `flushRowsToServer` ALSO PATCHes
    // `payload.accounts` (Ruling 95), and it runs BEFORE the turn resolves —
    // so its body still carries the PRE-turn value (100). The commit's own
    // PATCH is the LAST such call, made after adoption landed.
    const payloadPatchCalls = vi.mocked(fetch).mock.calls.filter(([url, init]) => {
      if (!String(url).endsWith("/imports/i1") || init?.method !== "PATCH") return false;
      const body = JSON.parse(init.body as string);
      return Boolean(body.payloadJson?.payload);
    });
    expect(payloadPatchCalls.length).toBeGreaterThanOrEqual(2);
    const [, commitPatchInit] = payloadPatchCalls.at(-1)!;
    const accounts = JSON.parse(commitPatchInit!.body as string).payloadJson.payload.accounts as Array<{
      __rowId: string;
      value: number;
    }>;
    expect(accounts.find((a) => a.__rowId === "r1")?.value).toBe(999);
  });
});

describe("ChatSurface — flushes local row state to the server BEFORE a turn is sent (Ruling 95)", () => {
  // Critical 1 (review round 1): a read-only turn used to snap the table
  // back to whatever the SERVER last held, discarding a restored row that
  // only ever lived in this surface's local state. The fix is to push
  // local state to the server first, so the model answers from what the
  // advisor sees and the wholesale adoption of its response is correct.
  //
  // Mutation this catches: swapping `flushRowsToServer`'s read of
  // `resultRef.current.rows` (the live ref) for a plain `result.rows`
  // closure capture — `useCallback([clientId, importId])` would then freeze
  // on whatever `result` was at mount (`null`), so the flush would find
  // nothing to send and the restored row's data would never reach the
  // server the turn route reads from.
  // Ruling 100 (fix round 2): restoring a row is a TWO-PART state change —
  // it goes INTO `payload.accounts` and must come OUT of
  // `chat.excludedRows`. Round 1's mock returned `excludedRows: []` on the
  // TURN response with no standing exclusion to strip in the first place —
  // a shape the real route could never produce for this scenario at the
  // time, which is exactly why it didn't catch the residual bug. This
  // version seeds the flush's fresh GET with the REAL persisted shape
  // `chat/extract/route.ts`'s own Step 0 write produces for a rollup
  // exclusion (`detectRollups` + `rollupExclusionReason`), so the flush's
  // filter has something genuine to remove.
  it("carries a locally restored row into the flush's PATCH before the turn's own POST, and strips it from chat.excludedRows in the same write", async () => {
    await renderAfterExtraction({ excluded: true }); // r1 kept, r2 ("All Accounts") excluded

    await userEvent.click(screen.getByRole("button", { name: /include anyway/i }));
    // Now in the working table locally — the server has never seen this.
    expect(screen.getByRole("row", { name: /All Accounts/ })).toBeInTheDocument();

    // The REAL standing state at this moment: Step 0 persisted r1 as the
    // kept account and r2 as a rollup exclusion — this is what the flush's
    // fresh GET actually reads back before the advisor's first turn.
    mockFlush({
      payload: { accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }] },
      chat: {
        surface: "chat",
        transcript: [],
        decisions: [],
        excludedRows: [
          {
            row: { name: "All Accounts", value: 300, __rowId: "r2" },
            reason: "a total covering 1 accounts already listed",
            decision: { kind: "rollup-excluded", label: "All Accounts", value: 300, coversCount: 1 },
          },
        ],
        committedRowIds: [],
      },
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [
          { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" },
          { name: "All Accounts", value: 300, __rowId: "r2" },
        ],
        summary: "Two accounts total $400.",
        turnEntries: [
          { role: "user", text: "what's the total?", at: "t1" },
          { role: "assistant", text: "Two accounts total $400.", at: "t1" },
        ],
        // Faithful for THIS scenario, not an unexamined default: the flush
        // just stripped r2 from chat.excludedRows server-side, so the real
        // route's fresh read at turn time genuinely has nothing left to
        // echo back.
        excludedRows: [],
      }),
    );

    await userEvent.type(composerTextbox(), "what's the total?");
    await userEvent.click(sendButton());
    await screen.findByText("Two accounts total $400.");

    // The flush is the FIRST PATCH to /imports/i1 — before the turn's own
    // POST to /chat/turn.
    const flushPatchCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith("/imports/i1") && init?.method === "PATCH");
    expect(flushPatchCall).toBeDefined();
    const [, flushInit] = flushPatchCall!;
    const flushBody = JSON.parse(flushInit!.body as string).payloadJson;

    // Clause 1a: it carries the restored row into payload.accounts.
    const flushedAccounts = flushBody.payload.accounts as Array<{ __rowId: string }>;
    expect(flushedAccounts.map((a) => a.__rowId).sort()).toEqual(["r1", "r2"]);
    // Clause 1b — THE assertion round 1 was missing: the SAME write also
    // strips r2 from chat.excludedRows. Mutation this catches: reverting
    // `flushRowsToServer` to write only `{ payload }` (dropping the `chat`
    // key entirely) — `flushBody.chat` would then be `undefined`.
    expect(flushBody.chat.excludedRows).toEqual([]);

    // And the read-only turn's wholesale adoption did NOT revert the
    // restore — the row is still in the working table after the turn, and
    // NOT also sitting in "Not included" with a live restore button.
    expect(screen.getByRole("row", { name: /All Accounts/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /include anyway/i })).not.toBeInTheDocument();
  });
});

describe("ChatSurface — restoring a row already in the working set never duplicates it (Ruling 100, clause 2)", () => {
  // Defense in depth, independent of clause 1's server-side fix: even if
  // `chat.excludedRows` still hands the SAME row back as excluded after
  // it is already in the working set (a slow flush, a concurrent session,
  // a genuinely fresh re-detection — adoption is a wholesale replace by
  // design, so this is a real, reachable response shape, not a fabricated
  // one), a second "Include anyway" click must never append a second copy
  // — the exact shape the re-review proved inserts two accounts on commit.
  it("does not append a duplicate row when 'Include anyway' is clicked for a row already in the working table", async () => {
    await renderAfterExtraction({ excluded: true }); // r1 kept, r2 ("All Accounts") excluded

    await userEvent.click(screen.getByRole("button", { name: /include anyway/i }));
    expect(screen.getAllByRole("row", { name: /All Accounts/ })).toHaveLength(1);

    mockFlush();
    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [
          { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" },
          { name: "All Accounts", value: 300, __rowId: "r2" },
        ],
        summary: "ok",
        turnEntries: [
          { role: "user", text: "hi", at: "t1" },
          { role: "assistant", text: "ok", at: "t1" },
        ],
        excludedRows: [
          {
            row: { name: "All Accounts", value: 300, __rowId: "r2" },
            reason: "a total covering 1 accounts already listed",
          },
        ],
      }),
    );
    await userEvent.type(composerTextbox(), "hi");
    await userEvent.click(sendButton());
    await screen.findByText("ok");

    // The row is back in "Not included" with a live restore button.
    const restoreButton = await screen.findByRole("button", { name: /include anyway/i });
    expect(restoreButton).toBeEnabled();

    await userEvent.click(restoreButton);

    // Mutation this catches: dropping the `alreadyWorking` guard in
    // `handleRestore` — the row would append a second time here.
    expect(screen.getAllByRole("row", { name: /All Accounts/ })).toHaveLength(1);
  });
});

describe("ChatSurface — Commit and Finish import are disabled for the whole in-flight window of a turn (Finding 4)", () => {
  // Without this, a commit clicked WHILE a turn's model call is running
  // (before its response — and this surface's own flush/adopt — land) can
  // dequeue immediately, PATCH pre-turn values, and lock a row at the OLD
  // value while the turn's edit shows up in the table moments later —
  // the screen and the client's plan then disagree, with no way to
  // re-commit the row from this surface. Mutation this catches: dropping
  // `disableCommit={turnStatus === "sending"}` from `<AccountsTable>`, or
  // dropping `|| turnStatus === "sending"` from Finish import's `disabled`.
  it("disables per-row Commit and Finish import only while turnStatus is 'sending', re-enabling after", async () => {
    await renderAfterExtraction();

    mockFlush();
    let resolveFetch!: (v: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    await userEvent.type(composerTextbox(), "hold on");
    await userEvent.click(sendButton());

    const row = screen.getByRole("row", { name: /IRA/ });
    expect(within(row).getByRole("button", { name: /^commit$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /finish import/i })).toBeDisabled();

    resolveFetch(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        summary: "ok",
        turnEntries: [
          { role: "user", text: "hold on", at: "t1" },
          { role: "assistant", text: "ok", at: "t1" },
        ],
      }),
    );

    await screen.findByRole("button", { name: /^send$/i });
    expect(within(screen.getByRole("row", { name: /IRA/ })).getByRole("button", { name: /^commit$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /finish import/i })).toBeEnabled();
  });
});

describe("ChatSurface — 'Re-run extraction' disables while a turn is sending (Ruling 98 / Finding 5)", () => {
  // Finding 5: an advisor sends a question, then (before this fix) could
  // click Re-run extraction while it was still in flight — `status` would
  // go "streaming", the turn's `onAdopted` would then fire `setStatus("done")`
  // unconditionally and flip `isStreaming` false WHILE the SSE stream was
  // still open, re-enabling the composer over an open extraction (Ruling
  // 63's second clause). Disabling this button for the whole
  // `turnStatus === "sending"` window closes the interleaving from this
  // side. Mutation this catches: dropping `|| turnStatus === "sending"`
  // from the button's `disabled` condition.
  it("disables 'Re-run extraction' for the whole in-flight window of a turn, re-enabling after", async () => {
    await renderAfterExtraction();

    mockFlush();
    let resolveFetch!: (v: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    await userEvent.type(composerTextbox(), "hold on");
    await userEvent.click(sendButton());

    expect(screen.getByRole("button", { name: /re-run extraction/i })).toBeDisabled();

    resolveFetch(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        summary: "ok",
        turnEntries: [
          { role: "user", text: "hold on", at: "t1" },
          { role: "assistant", text: "ok", at: "t1" },
        ],
      }),
    );

    await screen.findByRole("button", { name: /^send$/i });
    expect(screen.getByRole("button", { name: /re-run extraction/i })).toBeEnabled();
  });
});

describe("ChatSurface — transcript append survives a hydrated history plus a new turn (Important 6, executed mutation proof)", () => {
  // Important 6 from the review, executed: mutating `use-chat-commit.ts`'s
  // `setTranscript((prev) => [...prev, ...entries])` to `setTranscript(entries)`
  // (a REPLACE) left 89/89 green, because every prior test hydrated an
  // EMPTY transcript before a turn, or a non-empty one with NO turn — never
  // both together. This test does both: a resumed draft's hydrated history
  // must still be there after a NEW turn lands, not silently dropped.
  //
  // NOT `mockFlush()` before the turn here: `result` is still null on this
  // resumed draft (no extraction ran this session), so `flushRowsToServer`
  // no-ops — no fetch calls at all — and the turn's own POST is the very
  // next call after the mount GET.
  it("keeps the hydrated transcript AND appends the new turn's entries, not a replace", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValueOnce(
      importGetResponse({
        chat: {
          transcript: [
            { role: "user", text: "HYDRATED QUESTION", at: "t0" },
            { role: "assistant", text: "HYDRATED ANSWER", at: "t0" },
          ],
        },
      }),
    ); // mount GET

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={[]} />);
    await screen.findByText("HYDRATED QUESTION");

    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [],
        summary: "NEW ANSWER",
        turnEntries: [
          { role: "user", text: "NEW QUESTION", at: "t1" },
          { role: "assistant", text: "NEW ANSWER", at: "t1" },
        ],
      }),
    );

    await userEvent.type(composerTextbox(), "NEW QUESTION");
    await userEvent.click(sendButton());
    await screen.findByText("NEW ANSWER");

    // Both the hydrated history AND the new turn are present.
    expect(screen.getByText("HYDRATED QUESTION")).toBeInTheDocument();
    expect(screen.getByText("HYDRATED ANSWER")).toBeInTheDocument();
    expect(screen.getByText("NEW QUESTION")).toBeInTheDocument();
    expect(screen.getByText("NEW ANSWER")).toBeInTheDocument();
  });
});

describe("ChatSurface — a merge-retired row cannot be restored (Ruling 96 / Critical 2)", () => {
  // The brief's own contract note: restoring a merge_rows-retired row would
  // re-add the pre-merge row alongside the merged one and double-count the
  // account — exactly what Task 10's review graded CRITICAL for rollups.
  // Mutation this catches: `excluded-rows.tsx`'s button `disabled` condition
  // dropping `|| x.irreversible` — the button would render live, and
  // clicking it would put "Brokerage" back in the working table.
  it("renders 'Include anyway' disabled for a row merge_rows retired, and a click does nothing", async () => {
    await renderAfterExtraction(); // r1 IRA kept

    mockFlush();
    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 300, __rowId: "r1" }],
        summary: "Merged the two Schwab rows.",
        turnEntries: [
          { role: "user", text: "merge the two rows", at: "t1" },
          { role: "tool", tool: "merge_rows", summary: 'Merged "Brokerage" into "IRA".', at: "t1" },
          { role: "assistant", text: "Merged the two Schwab rows.", at: "t1" },
        ],
        excludedRows: [
          {
            row: { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2" },
            reason: 'merged into "IRA"',
            irreversible: true,
          },
        ],
      }),
    );

    await userEvent.type(composerTextbox(), "merge the two rows");
    await userEvent.click(sendButton());
    await screen.findByText("Merged the two Schwab rows.");

    const restoreButton = screen.getByRole("button", { name: /include anyway/i });
    expect(restoreButton).toBeDisabled();

    await userEvent.click(restoreButton);
    expect(screen.queryByRole("row", { name: /Brokerage/ })).not.toBeInTheDocument();
  });
});

describe("ChatSurface — turn failure modes are required behaviour, not polish (Step 3)", () => {
  it("renders the server's error copy for a failed turn, and restores the typed message", async () => {
    await renderAfterExtraction();

    mockFlush();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Too many messages. Please wait and try again." }), {
        status: 429,
        headers: { "retry-after": "5" },
      }),
    );

    const textbox = composerTextbox();
    await userEvent.type(textbox, "another question");
    await userEvent.click(sendButton());

    expect(
      await screen.findByText("Too many messages. Please wait and try again. Retry in 5s."),
    ).toBeInTheDocument();
    // Re-enabled on failure (brief Step 3), and the question wasn't lost.
    expect(sendButton()).toBeEnabled();
    expect(textbox).toBeEnabled();
    expect(textbox).toHaveValue("another question");
  });

  it("disables the composer while a turn is in flight, and re-enables once it resolves", async () => {
    await renderAfterExtraction();

    mockFlush();
    let resolveFetch!: (v: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const textbox = composerTextbox();
    await userEvent.type(textbox, "hello");
    await userEvent.click(sendButton());

    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
    expect(textbox).toBeDisabled();

    resolveFetch(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        summary: "ok",
        turnEntries: [
          { role: "user", text: "hello", at: "t1" },
          { role: "assistant", text: "ok", at: "t1" },
        ],
      }),
    );

    // Back to "Send" (no longer "Sending…") and the textbox is usable
    // again — the button itself stays disabled here only because the
    // successful send cleared it back to empty, not because anything is
    // still in flight, so type again and confirm it re-enables.
    await screen.findByRole("button", { name: /^send$/i });
    expect(textbox).toBeEnabled();
    await userEvent.type(textbox, "another one");
    expect(sendButton()).toBeEnabled();
  });
});

describe("ChatSurface — the composer disables for the whole extraction stream, not just a turn (Important 7, executed mutation proof)", () => {
  // Important 7 from the review, executed: mutating `chat-surface.tsx`'s
  // `disabled={isStreaming}` on `<ChatComposer>` to `disabled={false}` left
  // 36/36 component tests green — Ruling 63's "never accept a turn while an
  // extraction stream is open" guard was implemented but nothing caught its
  // removal. This drives the surface into a genuinely STREAMING state (an
  // extraction whose own fetch is deliberately held open) and asserts the
  // composer is unusable for that whole window.
  it("disables the composer while status is 'streaming', re-enabling once extraction settles", async () => {
    let resolveExtractFetch!: (v: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExtractFetch = resolve;
      }),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));

    expect(composerTextbox()).toBeDisabled();
    expect(sendButton()).toBeDisabled();

    resolveExtractFetch(makeFramedResponse([oneRowDoneFrame()]));
    await screen.findByRole("table");

    expect(composerTextbox()).toBeEnabled();
  });
});

describe("ChatSurface — the transcript auto-scrolls to the newest message (Minor 9)", () => {
  // jsdom has no real layout engine — `scrollHeight` is always 0 — so this
  // stubs it to a nonzero value on the transcript's own scroll container
  // (its `<ul>`) after the FIRST turn, then manually scrolls back to the
  // top (simulating an advisor who scrolled up to read history) before a
  // SECOND turn lands. Mutation this catches: removing the
  // `useEffect(() => { el.scrollTop = el.scrollHeight }, [transcript])` in
  // `chat-transcript.tsx` — `scrollTop` would stay at the `0` this test set
  // it to, never advancing to the stubbed `scrollHeight`.
  it("scrolls the transcript's own container to the bottom when a new turn lands", async () => {
    await renderAfterExtraction();

    mockFlush();
    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        summary: "first",
        turnEntries: [
          { role: "user", text: "first question", at: "t1" },
          { role: "assistant", text: "first", at: "t1" },
        ],
      }),
    );
    await userEvent.type(composerTextbox(), "first question");
    await userEvent.click(sendButton());
    await screen.findByText("first");

    const list = screen.getByRole("list");
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 777 });
    list.scrollTop = 0; // the advisor scrolled up to read earlier history

    mockFlush();
    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        summary: "second",
        turnEntries: [
          { role: "user", text: "second question", at: "t2" },
          { role: "assistant", text: "second", at: "t2" },
        ],
      }),
    );
    await userEvent.type(composerTextbox(), "second question");
    await userEvent.click(sendButton());
    await screen.findByText("second");

    expect(list.scrollTop).toBe(777);
  });
});

describe("ChatSurface — the composer grows with a multi-line question (Minor 10)", () => {
  // The report originally described this as "a single-line-growing
  // textarea" while the code was a fixed `rows={1}` — a Shift+Enter
  // multi-line question was typed into a box that never expanded to show
  // it. Mutation this catches: hardcoding `rows={1}` again in
  // `chat-composer.tsx` instead of the computed value.
  it("increases textarea rows as the advisor inserts newlines via Shift+Enter, up to the cap", async () => {
    await renderAfterExtraction();
    const textbox = composerTextbox() as HTMLTextAreaElement;
    expect(textbox.rows).toBe(1);

    await userEvent.type(textbox, "line one{Shift>}{Enter}{/Shift}line two{Shift>}{Enter}{/Shift}line three");

    expect(textbox.rows).toBe(3);
  });
});

describe("ChatSurface — a synthesized result never puts the turn's reply in the extraction-summary slot (Minor 8)", () => {
  // Mutation this catches: reverting `adoptTurnPayload`'s null-`prev`
  // branch to `{ summary, caveats: [], rows: accounts, excluded }` (the
  // turn's own reply text) instead of `{ summary: "", ... }` — the reply
  // would then render a SECOND time in the summary card above the table,
  // and (since every later turn's `prev` branch preserves that `summary`
  // untouched) the FIRST turn's reply would still be sitting there after a
  // second, unrelated turn.
  it("does not duplicate the first turn's reply into a summary card, and it never lingers after a later turn", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValueOnce(importGetResponse({}));
    render(<ChatSurface clientId="c1" importId="i1" initialFiles={[]} />);
    await screen.findByRole("textbox", { name: /ask a follow-up question/i });

    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        summary: "FIRST REPLY",
        turnEntries: [
          { role: "user", text: "q1", at: "t1" },
          { role: "assistant", text: "FIRST REPLY", at: "t1" },
        ],
      }),
    );
    await userEvent.type(composerTextbox(), "q1");
    await userEvent.click(sendButton());
    await screen.findByRole("table"); // the table now shows — status flipped to "done"

    // "FIRST REPLY" appears exactly once — in the transcript — never a
    // second time in a summary-card location above the table.
    expect(screen.getAllByText("FIRST REPLY")).toHaveLength(1);

    mockFlush();
    vi.mocked(fetch).mockResolvedValueOnce(
      turnResponse({
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        summary: "SECOND REPLY",
        turnEntries: [
          { role: "user", text: "q2", at: "t2" },
          { role: "assistant", text: "SECOND REPLY", at: "t2" },
        ],
      }),
    );
    await userEvent.type(composerTextbox(), "q2");
    await userEvent.click(sendButton());
    await screen.findByText("SECOND REPLY");

    // "FIRST REPLY" legitimately stays in the TRANSCRIPT (a persisted
    // history is supposed to keep it) — what must NOT happen is a SECOND,
    // stuck occurrence appearing in the summary-card slot after a later,
    // unrelated turn. Still exactly one occurrence proves that.
    expect(screen.getAllByText("FIRST REPLY")).toHaveLength(1);
  });
});

describe("ChatSurface — a flush failure tells the advisor their question was never sent (folded Minor, fix round 2)", () => {
  // The flush's own PATCH failing used to fall into `sendTurn`'s generic
  // catch and render `readImportPayloadJson`'s own message ("Could not
  // load the import (HTTP 500).") — true of the READ that failed, but it
  // never tells the advisor the thing they actually care about: their
  // question was never sent at all (Step 3's "never leave them wondering
  // whether it was heard"). Mutation this catches: removing the inner
  // try/catch around `await flushRowsToServer()` in `use-chat-turn.ts` —
  // the generic message would render instead, which this regex does not
  // match.
  it("renders a 'could not send your question' message, not a generic load/save error, when the pre-turn flush fails", async () => {
    await renderAfterExtraction();

    // The flush's own fresh GET (the first fetch call `sendTurn` makes)
    // fails — a real, reachable failure mode (a dropped connection, a
    // transient 500), not a fabricated shape.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Database unavailable" }), { status: 500 }),
    );

    const textbox = composerTextbox();
    await userEvent.type(textbox, "what's the total?");
    await userEvent.click(sendButton());

    expect(await screen.findByText(/could not send your question/i)).toBeInTheDocument();
    // Re-enabled, and the question wasn't lost.
    expect(sendButton()).toBeEnabled();
    expect(textbox).toHaveValue("what's the total?");
  });
});
