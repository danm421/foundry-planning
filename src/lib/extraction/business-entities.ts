import type { ExtractedAccount, ExtractedEntity } from "./types";

/** Entity types that are also a business account's sub-type, spelled the same. */
const LEGAL_FORMS: ReadonlySet<string> = new Set(["llc", "s_corp", "c_corp", "partnership"]);

const words = (name: string) => name.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** One name is the other, or the other cut short ("Hoboken Improvement Co, LP" of "… LP, and Affiliates"). */
function sameBusiness(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  const n = Math.min(x.length, y.length);
  return n > 0 && x.slice(0, n).every((w, i) => w === y[i]);
}

/**
 * A fact finder's balance sheet lists a business with its value, so the
 * accounts read makes it a business account; the entities read lists the same
 * business again, by name only — once from the balance sheet and again from
 * its income's name. Committed as it stands, the plan would hold the business
 * twice: the account with its value, and a $0 business entity beside it.
 *
 * This drops every entity reading of a business the document already lists as
 * a business account — trusts and foundations are never businesses, so they
 * stay — and hands the account the entity's legal form when the account's own
 * read came back missing or Other. Pure.
 */
export function foldBusinessEntities(extracted: {
  accounts: ExtractedAccount[];
  entities: ExtractedEntity[];
}): { accounts: ExtractedAccount[]; entities: ExtractedEntity[] } {
  const accounts = [...extracted.accounts];
  const entities = extracted.entities.filter((entity) => {
    // Names come off a loosely validated model response, so a non-string one is reachable.
    if (entity.entityType === "trust" || entity.entityType === "foundation" || typeof entity.name !== "string") return true;
    const i = accounts.findIndex(
      (a) => a.category === "business" && typeof a.name === "string" && sameBusiness(a.name, entity.name),
    );
    if (i < 0) return true;
    const form = entity.entityType;
    if (form && LEGAL_FORMS.has(form) && (accounts[i].subType ?? "other") === "other") {
      accounts[i] = { ...accounts[i], subType: form as ExtractedAccount["subType"] };
    }
    return false;
  });
  return { accounts, entities };
}
