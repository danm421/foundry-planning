import { ROW, detailsHref, differs, isActiveInYear, makeDelta, money, n, namesMatch, ref, rowAmountInYear } from "../compare";
import type { Check, Rule, Suggestion } from "../types";
import type { FindingLineRef } from "@/lib/tax-analysis/types";

/** One thing on the return that ought to reach the household as business income: a Schedule C, or
 *  the income boxes of one K-1. Both are matched and written the same way, so they share a shape. */
interface Item { id: string; name: string; amount: number | null; lineRefs: FindingLineRef[]; createName: string; source: string }

export const businessRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  const incomes = plan.incomes.filter((i) => i.type === "business" && isActiveInYear(i, planYear));
  const accounts = plan.accounts.filter((a) => a.category === "business");
  const entities = plan.entities.filter((e) => e.entityType !== "trust" && e.entityType !== "foundation");
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
    const row = incomes.find((r) => !claimed.has(r.id) && (namesMatch(it.name, r.name) || namesMatch(it.createName, r.name)));
    if (row) {
      claimed.add(row.id);
      const p = rowAmountInYear(row, taxYear);
      if (differs(it.amount, p, ROW)) {
        suggestions.push({ id: it.id, section: "business", kind: "update", status: "open",
          headline: `${it.name} shows ${money(it.amount)} on the ${taxYear} return; the plan's ${row.name} is ${money(p)}.`,
          meaning: "The return is the actual result for the year. Setting the row to it keeps its growth assumption and starts from what the business really made.",
          returnFigure, planFigure: { label: row.name, amount: p, display: money(p), year: planYear }, delta: makeDelta(it.amount, p),
          action: { label: `Set to ${money(it.amount)}`, describe: `Sets ${row.name} to ${money(it.amount)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: it.amount,
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
    suggestions.push({ id: it.id, section: "business", kind: "update", status: "open",
      headline: acct ? `${it.name} is on the balance sheet but sends the household no income.` : `${it.name} is on the return but not in the plan.`,
      meaning: `${it.source} shows ${money(it.amount)} for ${taxYear}. ${acct ? "This adds the income on the business account." : "This adds a business income row; link it to an entity or business account on Net Worth if one exists under another name."}`,
      returnFigure, planFigure: { label: acct ? acct.name : "No matching business", amount: null, display: "—", year: planYear }, delta: makeDelta(it.amount, null),
      action: { label: `Add income of ${money(it.amount)}`, describe: `Adds business income "${it.createName}" of ${money(it.amount)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: it.amount,
        target: { kind: "income.create", amountField: "annualAmount", input: { type: "business", name: it.createName, owner: "client", annualAmount: it.amount, growthRate: 0.03, inflationStartYear: taxYear, startYear: plan.planSettings.planStartYear, endYear: plan.planSettings.planEndYear, ...(acct ? { ownerAccountId: acct.id } : {}) } } } });
  }

  // The balance-sheet half of a K-1, which is a separate question from the income above: the
  // interest itself belongs in the plan so its value and estate treatment are modelled.
  facts.k1s.forEach((k, i) => {
    if (!k.entityName) return;
    const ent = plan.entities.find((e) => namesMatch(k.entityName, e.name));
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
