// src/lib/presentations/pages/household-map/view-model.ts
//
// The three Household Map presentation pages, built from the SAME
// `buildMapBoards` the advisor's on-screen Map and the client portal's
// Organizer call. That reuse is the whole point of this file: a card must not
// mean one thing on the board an advisor edits and something else in the deck
// they hand the client.
//
// Pure — no DB, no React, no `new Date()`. The caller passes `today`, exactly
// as `map-content.tsx` and `load-organizer-map.ts` do, so ages are reproducible
// in tests and cannot drift a Jan-1 DOB across timezones.

import { buildMapBoards } from "@/lib/household-map/build-boards";
import { moneyLabel } from "@/lib/household-map/format";
import { ageForYear } from "@/lib/age-year";
import { ASSUMED_LIFE_EXPECTANCY } from "@/lib/plan-horizon";
import type { MapItem, MapPeople } from "@/lib/household-map/types";
import type { MapGoal } from "@/lib/household-map/goals";
import type { ClientData } from "@/engine/types";
import { MAP_GOAL_KIND_HEX, MAP_GOAL_KIND_LABEL } from "./tokens";
import type {
  MapCashFlowBand,
  MapCashFlowPageData,
  MapColumnBlock,
  MapGoalsPageData,
  MapNetWorthPageData,
  MapTrayBlock,
} from "./types";

/** What every Household Map page needs off `BuildDataContext`, plus the clock
 *  read the registry supplies. Narrower than the full context on purpose —
 *  these pages read no projection, no Monte Carlo and no investments bundle. */
export interface HouseholdMapBuildInput {
  clientData: ClientData;
  scenarioLabel: string;
  today: Date;
}

const TRAY_LABEL = "Held by trusts, businesses & other family members";

/** Kinds the Net Worth board draws. Flow rows reach it only via the tray (an
 *  entity-owned rental's income, say) and are filtered out there too — the
 *  board is a balance sheet, not a cash flow. */
function isNetWorthKind(kind: MapItem["kind"]): boolean {
  return kind !== "income" && kind !== "savings" && kind !== "expense";
}

/**
 * Run the shared board builder off a presentation's effective tree.
 *
 * `identity` comes off `clientData.client` rather than a CRM query: the
 * presentation pipeline hands view-models an already-loaded effective tree and
 * nothing else, and `ClientInfo` carries all three fields the builder wants.
 * `lifeExpectancy` falls back to the engine's own assumption so a client with
 * no stored value still gets the milestone the projection is actually running
 * to — the same `?? 95` the Goals board labels "assumed".
 */
function boardsFor(input: HouseholdMapBuildInput) {
  const client = input.clientData.client;
  return buildMapBoards({
    effectiveTree: input.clientData,
    identity: {
      dateOfBirth: client.dateOfBirth,
      spouseDob: client.spouseDob ?? null,
      lifeExpectancy: client.lifeExpectancy ?? ASSUMED_LIFE_EXPECTANCY,
    },
    familyMemberRows: input.clientData.familyMembers ?? [],
    // `EntitySummary.name` is optional (engine call sites build these arrays
    // without one). An unnamed entity still has to tray its accounts somewhere,
    // so it gets a generic label rather than being dropped from the lookup.
    entityRows: (input.clientData.entities ?? []).map((e) => ({
      id: e.id,
      name: e.name ?? "Entity",
    })),
    today: input.today,
  });
}

/** "Alan 62 · Teresa 60" — the person nodes the boards draw, flattened to one
 *  line. Empty when neither DOB parsed, which is the honest answer: the nodes
 *  would show nothing either. */
function personLine(people: MapPeople): string {
  const parts = [people.client, people.spouse]
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p) => (p.age == null ? p.firstName : `${p.firstName} ${p.age}`));
  return parts.join("  ·  ");
}

/** Column headers, matching `NetWorthBoard.labelFor`. A solo household's middle
 *  column is "Joint" rather than "Jointly Held" — there is no second principal
 *  for it to be joint WITH, and the shorter label says so. */
function columnLabel(people: MapPeople, key: MapColumnBlock["key"]): string {
  const hasSpouse = people.spouse !== null;
  if (key === "client") return people.client.firstName || "Client";
  if (key === "spouse") return people.spouse?.firstName || "Spouse";
  return hasSpouse ? "Jointly Held" : "Joint";
}

function columnKeys(people: MapPeople): MapColumnBlock["key"][] {
  return people.spouse ? ["client", "joint", "spouse"] : ["client", "joint"];
}

function trayBlock(cards: MapItem[]): MapTrayBlock | null {
  return cards.length > 0 ? { label: TRAY_LABEL, cards } : null;
}

export function buildMapNetWorthData(input: HouseholdMapBuildInput): MapNetWorthPageData {
  const { people, items, netWorth } = boardsFor(input);
  const balanceItems = items.filter((i) => isNetWorthKind(i.kind));

  const columns: MapColumnBlock[] = columnKeys(people).map((key) => {
    const cards = balanceItems.filter((i) => i.column === key);
    return {
      key,
      label: columnLabel(people, key),
      cards,
      subtotalLabel: moneyLabel(cards.reduce((s, c) => s + c.value, 0)),
    };
  });

  return {
    title: "Household Map — Net Worth",
    subtitle: input.scenarioLabel,
    personLine: personLine(people),
    columns,
    tray: trayBlock(balanceItems.filter((i) => i.column === "tray")),
    totalLabel: "Total assets − debts",
    totalValueLabel: moneyLabel(netWorth),
  };
}

const BANDS: { key: MapCashFlowBand["key"]; label: string; kind: MapItem["kind"] }[] = [
  { key: "income", label: "Income", kind: "income" },
  { key: "savings", label: "Savings", kind: "savings" },
  { key: "expense", label: "Expenses", kind: "expense" },
];

/**
 * A savings card whose contribution is a RULE, not a number — "IRS max",
 * "10% of pay", a custom schedule. `resolveSavings` gives exactly this set
 * `value: 0` and `editableAmount: null` (see `MapItem.editableAmount`), and the
 * real dollars land in the projection.
 *
 * It matters here and nowhere else on the board: a subtotal that swallows one
 * of these is not "$0 saved", it is "we don't know", and a printed page has no
 * card to hover for the correction.
 */
function isSavingsSetByRule(item: MapItem): boolean {
  return item.kind === "savings" && item.editableAmount === null;
}

/** The rules driving a band, verbatim off the cards and de-duplicated, in the
 *  order they appear: "IRS max", or "IRS max · 10% of pay" when they differ.
 *  Echoing `valueLabel` rather than re-wording it keeps the band foot and the
 *  card above it saying the same thing. */
function savingsRuleLabel(cards: MapItem[]): string {
  return [...new Set(cards.map((c) => c.valueLabel))].join(" · ");
}

// Names no rules of its own — the band foot now prints them, and repeating them
// here read as two different lists.
const SAVINGS_BY_RULE_NOTE =
  "These contributions resolve in the projection, so no dollar total on this page includes them.";

export function buildMapCashFlowData(input: HouseholdMapBuildInput): MapCashFlowPageData {
  const { people, items } = boardsFor(input);
  const keys = columnKeys(people);
  const byRule = items.some(isSavingsSetByRule);

  const bands: MapCashFlowBand[] = BANDS.map((band) => {
    const bandItems = items.filter((i) => i.kind === band.kind);
    // Column order, then tray — the order a reader meets the cards, so the
    // foot lists the rules in the order the page already showed them.
    const ruleCards = [...keys, "tray" as const].flatMap((key) =>
      bandItems.filter((i) => i.column === key && isSavingsSetByRule(i)),
    );
    return {
      key: band.key,
      label: band.label,
      columns: keys.map((key) => ({
        key,
        label: columnLabel(people, key),
        cards: bandItems.filter((i) => i.column === key),
        // Null: a column subtotal inside a band invites reading DOWN the page,
        // and the board totals across a band, not down a column.
        subtotalLabel: null,
      })),
      tray: trayBlock(bandItems.filter((i) => i.column === "tray")),
      // Across columns AND tray. `MapItem.value` is signed — inflows positive,
      // expenses and savings contributions negative — so this sum needs no
      // kind-specific special-casing. It is withheld only when the band holds a
      // rule-based card, whose 0 would make the total read as a fact — and the
      // foot then names the rule instead of printing a dash.
      subtotalLabel:
        ruleCards.length > 0 ? null : moneyLabel(bandItems.reduce((s, i) => s + i.value, 0)),
      subtotalRuleLabel: ruleCards.length > 0 ? savingsRuleLabel(ruleCards) : null,
    };
  });

  const flowKinds = new Set(BANDS.map((b) => b.kind));
  const net = items.filter((i) => flowKinds.has(i.kind)).reduce((s, i) => s + i.value, 0);

  return {
    title: "Household Map — Cash Flow",
    subtitle: input.scenarioLabel,
    personLine: personLine(people),
    bands,
    // Spelled out, not called "net cash flow": the Cash Flow report owns that
    // term for a projected, tax-aware figure. This is the arithmetic of the
    // cards printed above it, and nothing else — so it is withheld outright
    // when one of those cards is a rule this page cannot price.
    netLabel: "Income less savings & expenses",
    netValueLabel: byRule ? null : moneyLabel(net),
    unresolvedNote: byRule ? SAVINGS_BY_RULE_NOTE : null,
  };
}

/** Both principals' ages in a goal's year, matching `GoalsBoard.agesAt`. */
function agesLabel(people: MapPeople, year: number): string {
  const clientAge = ageForYear(people.client.birthYear, year);
  if (!people.spouse) return clientAge != null ? String(clientAge) : "";
  const spouseAge = ageForYear(people.spouse.birthYear, year);
  return `${clientAge ?? "—"} / ${spouseAge ?? "—"}`;
}

export function buildMapGoalsData(input: HouseholdMapBuildInput): MapGoalsPageData {
  const { people, goals } = boardsFor(input);

  return {
    title: "Household Map — Goals",
    subtitle: input.scenarioLabel,
    clientName: people.client.firstName || "Client",
    spouseName: people.spouse?.firstName ?? null,
    rows: goals.map((g: MapGoal) => ({
      id: g.id,
      year: g.year,
      agesLabel: agesLabel(people, g.year),
      side: g.side,
      kindLabel: MAP_GOAL_KIND_LABEL[g.kind],
      accentHex: MAP_GOAL_KIND_HEX[g.kind],
      title: g.title,
      forLabel: g.forFamilyMemberName ? `for ${g.forFamilyMemberName}` : null,
      detail: g.detail,
    })),
    // Gated on real, expense-backed goals rather than a card count — the life
    // milestones are always present, so a count threshold would never fire.
    emptyNote: goals.some((g) => g.expenseId !== null)
      ? null
      : "No goals on this plan yet — the milestones below come from the plan's retirement, life-expectancy and Social Security assumptions.",
  };
}
