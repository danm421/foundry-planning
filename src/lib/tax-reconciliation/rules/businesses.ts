import { ROW, detailsHref, differs, editableAmount, hasSpouse, isActiveInYear, makeDelta, money, n, namesMatch, normalizeName, ref, rowAmountInYear } from "../compare";
import type { Check, OwnerChoice, PlanIncome, Rule, Suggestion } from "../types";
import type { FindingLineRef } from "@/lib/tax-analysis/types";

/** One thing on the return that ought to reach the household as business income: a Schedule C, or
 *  the income boxes of one K-1. Both are matched and written the same way, so they share a shape. */
interface Item { id: string; name: string; amount: number | null; lineRefs: FindingLineRef[]; createName: string; source: string }

export const businessRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  // Match against EVERY business row, ended ones included. A row the advisor modelled as stopping
  // in the tax year would otherwise be invisible to the matcher, and its own Schedule C would fall
  // through to the create arm and offer to restart the business for the life of the plan — the
  // wind-down year is one of the likeliest years to be reconciling a return at all.
  const businessRows = plan.incomes.filter((i) => i.type === "business");
  const accounts = plan.accounts.filter((a) => a.category === "business");
  const entities = plan.entities.filter((e) => e.entityType !== "trust" && e.entityType !== "foundation");
  // Neither a Schedule C nor a K-1 carries a taxpayer/spouse indicator, so the return cannot say
  // whose business it is — and ownership drives survivor modelling. `owner: "client"` on the create
  // arm is only the default the advisor overrides.
  const spouse = hasSpouse(plan);
  const ownerChoices: OwnerChoice[] | undefined = spouse ? ["client", "spouse"] : undefined;
  const ownerNote = spouse ? " The return does not say whose it is; pick the owner first." : "";
  // One candidate — row, account or entity — belongs to at most one item. `namesMatch` accepts
  // near-spellings, so two businesses on the return can both look like the same plan row; without
  // this, first-match-wins would offer that one row to each of them.
  const claimed = new Set<string>();
  const items: Item[] = [
    ...facts.businesses.map((b, i) => ({ id: `business.scheduleC.${i}`, name: b.name ?? `Schedule C #${i + 1}`, amount: b.netProfit, lineRefs: [ref("Sched C", "31", `${b.name ?? "Business"} net profit`, b.netProfit)], createName: b.name ?? `Business (from ${taxYear} return)`, source: "Schedule C" })),
    ...facts.k1s.map((k, i) => {
      // All-null boxes mean the K-1 said nothing about income, which is not the same as saying zero.
      const parts = [k.ordinaryBusinessIncome, k.guaranteedPayments, k.rentalIncome];
      const amount = parts.every((p) => p == null) ? null : n(k.ordinaryBusinessIncome) + n(k.guaranteedPayments) + n(k.rentalIncome);
      const name = k.entityName ?? `K-1 #${i + 1}`;
      return { id: `business.k1.${i}.income`, name, amount, lineRefs: [ref("K-1", "1", `${name} ordinary income`, k.ordinaryBusinessIncome), ref("K-1", "4", "Guaranteed payments", k.guaranteedPayments), ref("K-1", "2", "Rental income", k.rentalIncome)], createName: `${name} (K-1)`, source: "K-1" };
    }),
  ];

  for (const it of items) {
    if (it.amount == null) continue;
    const returnFigure = { label: `${it.name} · ${it.source}`, amount: it.amount, display: money(it.amount), lineRefs: it.lineRefs };
    // Candidate ORDER matters, not just the predicate: `namesMatch` accepts containment and
    // near-spellings, so an ended "Acme Corp" would take a live "Acme Consulting"'s Schedule C on
    // array order alone. Exactness is the key; activity only breaks ties WITHIN an exactness class.
    // A K-1 is matched under both its own name and the "(K-1)" name the create arm would give it.
    // `wanted` is filtered because `normalizeName` drops every suffix token — a business named
    // "LLC" normalizes to "", and an unguarded exact tier would let it match another empty name.
    const available = businessRows.filter((r) => !claimed.has(r.id));
    const wanted = [normalizeName(it.name), normalizeName(it.createName)].filter(Boolean);
    const exact = available.filter((r) => wanted.includes(normalizeName(r.name)));
    const fuzzy = (r: PlanIncome) => namesMatch(it.name, r.name) || namesMatch(it.createName, r.name);
    const row =
      exact.find((r) => isActiveInYear(r, planYear))
      ?? exact[0]
      ?? available.find((r) => isActiveInYear(r, planYear) && fuzzy(r))
      ?? available.find(fuzzy);
    if (row) {
      claimed.add(row.id);
      if (!isActiveInYear(row, planYear)) {
        // The row is real and it matched, it just does not overlap the plan year — a business
        // already wound down, or one not started yet. There is nothing to write, so record that the
        // return figure was accounted for and name the row that carries it.
        checks.push({ id: it.id, label: it.name, returnDisplay: money(it.amount),
          planDisplay: row.endYear < planYear ? `${row.name} ends in ${row.endYear}, before the ${planYear} plan year` : `${row.name} starts in ${row.startYear}, after the ${planYear} plan year` });
        continue;
      }
      const p = rowAmountInYear(row, taxYear);
      if (differs(it.amount, p, ROW)) {
        suggestions.push({ id: it.id, section: "business", kind: "update", status: "open",
          headline: `${it.name} shows ${money(it.amount)} on the ${taxYear} return; the plan's ${row.name} is ${money(p)}.`,
          meaning: "The return is the actual result for the year. Setting the row to it keeps its growth assumption and starts from what the business really made.",
          returnFigure, planFigure: { label: row.name, amount: p, display: money(p), year: planYear }, delta: makeDelta(it.amount, p),
          action: { label: `Set to ${money(it.amount)}`, describe: `Sets ${row.name} to ${money(it.amount)} (${taxYear} dollars)`, amountEditable: editableAmount(it.amount), defaultAmount: it.amount,
            target: { kind: "income.update", incomeId: row.id, patch: { annualAmount: it.amount, inflationStartYear: taxYear }, amountField: "annualAmount" } } });
      } else checks.push({ id: it.id, label: it.name, returnDisplay: money(it.amount), planDisplay: money(p) });
      continue;
    }
    const acct = accounts.find((a) => !claimed.has(a.id) && namesMatch(it.name, a.name));
    if (acct) claimed.add(acct.id);
    const ent = acct ? undefined : entities.find((e) => !claimed.has(e.id) && namesMatch(it.name, e.name));
    if (ent) claimed.add(ent.id);
    // A business that lost money has nothing to offer once no plan row carries it: there is no
    // income to add, and an entity that ran at a loss really does send the household nothing. The
    // candidates above are still claimed first, so a loss does not leave its own account or entity
    // free for the next business to take by near-spelling. Guarding here rather than only at the
    // create arm also keeps `makeDelta` away from a negative return figure with no plan row, which
    // it tones "Plan is $5,000 over" — the plan reads as too generous when the business lost money.
    if (it.amount <= 0) continue;
    if (ent) {
      suggestions.push({ id: it.id, section: "business", kind: "review", status: "open",
        headline: `${it.name} shows ${money(it.amount)} on the return; the plan models it as an entity with no income row.`,
        meaning: "The entity is on the balance sheet, but no income from it reaches the household this year. Add the distribution or an income row on Net Worth.",
        returnFigure, planFigure: { label: ent.name, amount: 0, display: "$0", year: planYear }, delta: makeDelta(it.amount, 0), link: { label: "Open Net Worth", href: detailsHref(input, "net-worth") } });
      continue;
    }
    // `.create` is a dismissal id of its own: dismissing "add this business" must not also suppress
    // "this business's amount is off", and those ids are persisted.
    suggestions.push({ id: `${it.id}.create`, section: "business", kind: "update", status: "open",
      headline: acct ? `${it.name} is on the balance sheet but sends the household no income.` : `${it.name} is on the return but not in the plan.`,
      meaning: `${it.source} shows ${money(it.amount)} for ${taxYear}. ${acct ? "This adds the income on the business account." : "This adds a business income row; link it to an entity or business account on Net Worth if one exists under another name."}${ownerNote}`,
      returnFigure, planFigure: { label: acct ? acct.name : "No matching business", amount: null, display: "—", year: planYear }, delta: makeDelta(it.amount, null),
      action: { label: `Add income of ${money(it.amount)}`, describe: `Adds business income "${it.createName}" of ${money(it.amount)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: it.amount, ownerChoices,
        target: { kind: "income.create", amountField: "annualAmount", ownerField: "owner", input: { type: "business", name: it.createName, owner: "client", annualAmount: it.amount, growthRate: 0.03, inflationStartYear: taxYear, startYear: plan.planSettings.planStartYear, endYear: plan.planSettings.planEndYear, ...(acct ? { ownerAccountId: acct.id } : {}) } } } });
  }

  // The balance-sheet half of a K-1, which is a separate question from the income above: the
  // interest itself belongs in the plan so its value and estate treatment are modelled.
  //
  // This loop searches the trust/foundation-excluded `entities`, and claims with a set of its own.
  // Excluding trusts stops a K-1 that merely near-matches a plan TRUST from drawing a QBI treatment
  // onto it, and the claim set stops two near-named K-1s both writing to one entity. The set is
  // separate from `claimed` above because the items loop claims an entity to say "this business's
  // income is missing" — a different question from "this entity is in the plan". Sharing one set
  // would make a K-1 that had already reviewed its own entity look like it had none, and offer to
  // create a duplicate.
  const claimedEntities = new Set<string>();
  facts.k1s.forEach((k, i) => {
    if (!k.entityName) return;
    const ent = entities.find((e) => !claimedEntities.has(e.id) && namesMatch(k.entityName, e.name));
    if (ent) claimedEntities.add(ent.id);
    const qbi = n(k.qbiIncome) > 0;
    if (!ent) {
      // Entity CREATION is gated on the type, because only an S-corp or a partnership interest is
      // an entity the plan can model. An estate/trust K-1 is someone else's entity, so it gets an
      // income row above and nothing here.
      if (k.entityType !== "s_corp" && k.entityType !== "partnership") return;
      suggestions.push({ id: `business.k1.${i}.entity`, section: "business", kind: "update", status: "open",
        headline: `${k.entityName} issued a K-1 but is not an entity in the plan.`,
        meaning: `An ${k.entityType === "s_corp" ? "S corporation" : "partnership"} interest belongs on the balance sheet so its value and estate treatment are modeled. This adds it at $0; set the value on Net Worth.`,
        returnFigure: { label: "K-1 entity", amount: null, display: k.entityType === "s_corp" ? "S corporation" : "Partnership", lineRefs: [ref("K-1", "Part I", k.entityName, null)] },
        planFigure: { label: "Entities in the plan", amount: null, display: "Not found", year: planYear }, delta: { amount: null, display: "Not in the plan", tone: "missing" },
        action: { label: `Add ${k.entityName}`, describe: `Adds entity "${k.entityName}" (${k.entityType === "s_corp" ? "S corp" : "partnership"}, ${qbi ? "QBI" : "ordinary"} income)`, amountEditable: false, defaultAmount: null,
          target: { kind: "entity.create", input: { name: k.entityName, entityType: k.entityType, taxTreatment: qbi ? "qbi" : "ordinary", value: 0 } } } });
      return;
    }
    if (qbi && ent.taxTreatment === "ordinary") {
      suggestions.push({ id: `business.k1.${i}.qbi`, section: "business", kind: "update", status: "open",
        headline: `${ent.name} reports qualified business income; the plan taxes it as ordinary income.`,
        meaning: `The K-1 shows ${money(n(k.qbiIncome))} of QBI, which earns the 20% deduction. Marking the entity QBI lets the plan take it.`,
        returnFigure: { label: "QBI on the K-1", amount: k.qbiIncome, display: money(k.qbiIncome), lineRefs: [ref("K-1", "20Z / 17V", "Qualified business income", k.qbiIncome)] },
        planFigure: { label: `${ent.name} tax treatment`, amount: null, display: "Ordinary", year: planYear }, delta: { amount: null, display: "Differs", tone: "neutral" },
        action: { label: "Mark as QBI", describe: `Sets ${ent.name}'s tax treatment to qualified business income`, amountEditable: false, defaultAmount: null, target: { kind: "entity.update", entityId: ent.id, patch: { taxTreatment: "qbi" } } } });
    }
  });

  return { suggestions, checks };
};
