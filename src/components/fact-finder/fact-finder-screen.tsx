"use client";
// src/components/fact-finder/fact-finder-screen.tsx
// The fact finder import screen — the client entry the server page renders:
// the worksheet of AI-built tables on the left, and the documents & chat panel
// on the right, where each plan update is confirmed on a proposal card and
// saved as a round of its own. Finish import closes the import; a finished one
// shows the same worksheet and conversation, read-only, under a banner.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/card";
import DialogShell from "@/components/dialog-shell";
import type { ErrorResponse, FinishResponse } from "@/lib/fact-finder/api-types";
import type { ChangeLine } from "@/lib/fact-finder/change-set";
import { filesReading } from "@/lib/fact-finder/reading-status";
import type { FFChatTurn } from "@/lib/fact-finder/types";
import { GHOST_BUTTON } from "./button-styles";
import { ChatComposerBar, ChatPanel } from "./chat-panel";
import { DocumentsPanel, useDocuments } from "./documents-panel";
import { OFFLINE_MESSAGE, factFinderUrl, refusalText } from "./http";
import { AlertIcon, CircleCheckIcon, LoaderIcon, PanelIcon } from "./icons";
import { LocalDate } from "./local-date";
import { ProposalCard } from "./proposal-card";
import type { FactFinderScreenProps } from "./screen-types";
import { BESIDE_GRID_STYLE, SidePanel, useNarrowScreen } from "./side-panel";
import { useChangeTicks } from "./use-change-ticks";
import { useFactFinder } from "./use-fact-finder";
import { useReview } from "./use-review";
import { useSave } from "./use-save";
import { useWorksheetChat } from "./use-worksheet-chat";
import { WorksheetPane } from "./worksheet-pane";

const PANEL_ID = "fact-finder-panel";
const PANEL_TITLE = "Documents & chat";
const FINISH_TITLE = "Finish import";
const FINISH_QUESTION = "Finish this import? You can't add documents or save more changes to the plan from it afterwards.";
const DISMISS_CLASS = "shrink-0 text-ink-3 underline underline-offset-2 hover:text-ink hover:no-underline";

type ProposalTurn = Extract<FFChatTurn, { role: "proposal" }>;

function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-crit">
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}

export function FactFinderScreen({ clientId, importId, initialState, initialFiles, clientDocuments }: FactFinderScreenProps) {
  // Kept for the fact finder itself, adopting what each route answers, and the one edit this screen makes (Add as new).
  const store = useFactFinder({ clientId, importId, initialState });
  const state = store.state;
  const closed = state.closed;
  const chat = useWorksheetChat({ clientId, importId, adopt: store.adopt });
  // Each finished read is owed a compose, which folds every document read since the last one into the worksheet.
  // `composedReads` counts the finished reads covered by the last compose that started.
  const [readsDone, setReadsDone] = useState(0);
  const composedReads = useRef(0);
  const docs = useDocuments({
    clientId,
    importId,
    initialFiles,
    state,
    refresh: store.refresh,
    adopt: store.adopt,
    onReadDone: () => setReadsDone((n) => n + 1),
  });
  const reading = docs.read.running || filesReading(state, new Date()).length > 0;
  const busy = reading || chat.pending !== null || chat.undoing !== null;
  const narrow = useNarrowScreen();
  const [panelOpen, setPanelOpen] = useState(true);
  const beside = panelOpen && !narrow;

  const ticks = useChangeTicks(importId, state.changeSet);
  const review = useReview({
    clientId,
    importId,
    flushNow: store.flushNow,
    adopt(fresh) {
      store.adopt(fresh);
      save.dismiss();
    },
  });
  // Always a round that keeps the import open: only Finish closes it, so the closed import lists every round's records.
  const save = useSave({
    clientId,
    importId,
    onSaved: store.adopt,
    onStale(fresh) {
      if (fresh) store.adopt(fresh);
    },
  });

  const [confirming, setConfirming] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // Finished while open here (this Finish, or another tab's seen on a reply): the banner takes focus, as the controls that had it are gone.
  const [startedOpen] = useState(!initialState.closed);
  const bannerRef = useRef<HTMLParagraphElement>(null);
  const isClosed = closed !== undefined;
  useEffect(() => {
    if (isClosed && startedOpen) bannerRef.current?.focus();
  }, [isClosed, startedOpen]);

  // The owed compose starts once nothing else runs (a reply, an Undo, a read), so reads that finish meanwhile share
  // it. They stay owed until it actually starts: a request begun since this render keeps them owed until that one
  // ends. One that starts and then fails isn't retried: the next read's compose folds its documents in too.
  useEffect(() => {
    if (busy || isClosed || composedReads.current === readsDone) return;
    if (chat.compose()) composedReads.current = readsDone;
  }, [busy, isClosed, readsDone, chat]);

  async function finish() {
    setFinishing(true);
    setFinishError(null);
    try {
      const res = await fetch(`${factFinderUrl(clientId, importId)}/finish`, { method: "POST" }).catch(() => null);
      if (!res) {
        setFinishError(OFFLINE_MESSAGE);
        return;
      }
      const answer = (await res.json().catch(() => ({}))) as Partial<FinishResponse & ErrorResponse>;
      if (res.ok && answer.factFinder) store.adopt(answer.factFinder);
      else setFinishError(refusalText(res, answer.error, "Couldn't finish the import"));
    } finally {
      setFinishing(false);
      setConfirming(false);
    }
  }

  function match(tableId?: string) {
    const table = state.worksheet.tables.find((t) => t.id === tableId);
    // The reply and its proposal land in the chat: show it.
    setPanelOpen(true);
    void chat.send(
      table ? `Match the "${table.title}" table to the plan.` : "Match every table to the plan.",
      table ? { tableId: table.id } : {},
    );
  }

  async function addAsNew(turn: ProposalTurn, line: ChangeLine) {
    if (!store.apply([{ op: "setLink", sectionId: line.sectionId, rowId: line.rowId, link: { kind: "new" } }])) return;
    await store.flushNow();
    await review.review(turn.rowIds);
  }

  const latestProposal = state.transcript.findLast((turn) => turn.role === "proposal")?.id;
  // Why the latest card's Propose again or Add as new didn't go through: the review's refusal, else the edit's.
  const cardError = review.error ?? store.error;

  function renderProposal(turn: ProposalTurn) {
    if (closed) return null;
    const latest = turn.id === latestProposal;
    const { changeSet } = state;
    return (
      <div className="flex flex-col gap-2">
        <ProposalCard
          state={state}
          turn={turn}
          latest={latest}
          ticks={ticks}
          onSave={() => {
            if (changeSet) void save.save(changeSet, ticks.ticks, { keepOpen: true });
          }}
          saving={save.saving}
          saveError={save.error}
          onAddAsNew={(line) => void addAsNew(turn, line)}
          onReviewAgain={() => void review.review(turn.rowIds)}
        />
        {latest && review.reviewing && (
          <p role="status" className="flex items-center gap-2 text-xs text-ink-3">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            Working on it…
          </p>
        )}
        {latest && !review.reviewing && cardError && <ErrorLine message={cardError} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href={`/clients/${clientId}/details/import`} className="text-sm text-ink-3 underline-offset-2 hover:underline">
            ← Back to imports
          </Link>
          <h1 className="text-xl font-semibold text-ink">Fact finder import</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls={PANEL_ID}
            onClick={() => setPanelOpen((open) => !open)}
            className={GHOST_BUTTON}
          >
            <PanelIcon />
            {PANEL_TITLE}
          </button>
          {!closed && (
            <button type="button" onClick={() => setConfirming(true)} className={GHOST_BUTTON}>
              {FINISH_TITLE}
            </button>
          )}
        </div>
        {finishError && (
          <div className="flex w-full items-start justify-end gap-3 text-sm">
            <ErrorLine message={finishError} />
            <button type="button" onClick={() => setFinishError(null)} className={DISMISS_CLASS}>
              Dismiss
            </button>
          </div>
        )}
      </header>

      {closed && (
        <Card className="flex items-start gap-2 px-[var(--pad-card)] py-4">
          <CircleCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good" />
          <p
            ref={bannerRef}
            role="status"
            tabIndex={-1}
            className="rounded-[var(--radius-sm)] text-sm text-ink focus:outline-2 focus:outline-offset-2 focus:outline-accent"
          >
            Finished <LocalDate iso={closed.at} /> — <span className="tabular">{closed.saved.length}</span> item(s) saved
            to the plan.
          </p>
        </Card>
      )}

      <div
        className={`grid items-start gap-6 ${beside ? "grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1"}`}
        style={beside ? BESIDE_GRID_STYLE : undefined}
      >
        <div className="min-w-0">
          <WorksheetPane state={state} fileName={docs.fileName} onMatch={closed ? undefined : match} busy={busy} />
        </div>

        <SidePanel
          id={PANEL_ID}
          title={PANEL_TITLE}
          open={panelOpen}
          overlay={narrow}
          onOpenChange={setPanelOpen}
          footer={closed ? undefined : <ChatComposerBar chat={chat} reading={reading} />}
        >
          {!closed && (
            <DocumentsPanel clientId={clientId} importId={importId} docs={docs} state={state} clientDocuments={clientDocuments} />
          )}
          <ChatPanel chat={chat} state={state} renderProposal={renderProposal} />
        </SidePanel>
      </div>

      <DialogShell
        open={confirming}
        onOpenChange={setConfirming}
        title={FINISH_TITLE}
        size="sm"
        primaryAction={{ label: finishing ? "Finishing…" : FINISH_TITLE, onClick: () => void finish(), disabled: finishing }}
      >
        <p className="text-[14px] text-ink-2">{FINISH_QUESTION}</p>
      </DialogShell>
    </div>
  );
}
