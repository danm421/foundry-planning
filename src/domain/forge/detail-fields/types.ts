// src/domain/forge/detail-fields/types.ts
//
// Shape of the Details field map — the catalogue Forge reads to answer
// "what can I actually fill in on this client?" before it writes extracted
// data anywhere.
//
// This is a HAND-AUTHORED registry, not a generated one. Roughly half the
// Details write routes validate with a zod schema in `src/lib/schemas/`; the
// other half validate ad hoc inside the route handler, so there is no single
// artifact to derive from. `__tests__/detail-fields.test.ts` pins every
// `table` and `routes` entry against the real schema and filesystem so the
// map cannot drift silently even though it is written by hand.

/** The eight tabs in the Details sidebar (`src/components/details-sidebar.tsx`). */
export type DetailsTab =
  | "profile"
  | "observations"
  | "net-worth"
  | "income-expenses"
  | "insurance"
  | "techniques"
  | "wills"
  | "assumptions";

/**
 * How a value is entered and what it means — chosen so Forge can coerce an
 * extracted string into the right JSON type without reading the route.
 *
 * `rate` is a decimal fraction (0.03 = 3%); `percent` is a whole number
 * (3 = 3%). Getting these two backwards is the single most common way to be
 * off by 100x, so they are separate kinds rather than one "percentage".
 */
export type FieldKind =
  | "string"
  | "text"
  | "money"
  | "number"
  | "rate"
  | "percent"
  | "year"
  | "date"
  | "boolean"
  | "enum"
  | "uuid"
  | "object"
  | "array";

export interface DetailField {
  /** Key in the request payload — NOT necessarily the database column. */
  key: string;
  /** The label an advisor reads on screen, so Forge can name it back to them. */
  label: string;
  kind: FieldKind;
  /** Every accepted value, for `kind: "enum"`. */
  enumValues?: readonly string[];
  /** Required in the CREATE payload. Absent/false means optional. */
  required?: boolean;
  /** Value the server writes when the key is omitted on create. */
  defaultValue?: string | number | boolean | null;
  /** Accepts `null` explicitly (distinct from being omitted). */
  nullable?: boolean;
  /** Server-enforced bounds, where the route or schema declares them. */
  range?: { min?: number; max?: number };
  /**
   * Present and false when the field is shown on the Details screen but is
   * derived rather than stored — Forge must never try to write it.
   */
  writable?: boolean;
  /**
   * Restricts the field to one operation. Absent means both accept it.
   *
   * "update" is the common case: a key the create schema strips (an account's
   * `notes`, an open item's `completedAt`). Sending it on create is not an
   * error — zod drops it silently and the value never lands, which is worse
   * than a rejection because nothing tells the advisor it was ignored.
   */
  appliesTo?: "create" | "update";
  /** Anything Forge would get wrong from the type alone. */
  notes?: string;
  /**
   * Other wordings a document may print for this field: "Face Amount" for a
   * death benefit, "Elimination Period" for a waiting period. Fed to the
   * extraction prompt. This is the cheapest fix when a real document extracts
   * badly — an alias, not a new prompt.
   */
  aliases?: readonly string[];
}

export interface DetailEntityRoutes {
  /** Paths below `/api/clients/[id]`, e.g. `"/insurance-policies"`. */
  list?: string;
  create?: string;
  update?: string;
  delete?: string;
}

export interface DetailEntity {
  /** Stable snake_case id — the handle a Forge tool would take. */
  id: string;
  label: string;
  tab: DetailsTab;
  /** Where the advisor edits this, in screen terms: "Insurance → Add policy". */
  surface: string;
  /** Exported table name in `src/db/schema.ts`. */
  table: string;
  routes: DetailEntityRoutes;
  /**
   * Exported zod schema validating creates, if the route uses one.
   *
   * `validatesSubset` marks a schema that checks only PART of the body — a
   * business account is validated by `accountCreateSchema`, which delegates the
   * business-specific keys to `AddBusinessInputSchema`. The body then carries
   * keys this schema never mentions, so it cannot be read as the full contract.
   */
  createSchema?: { module: string; export: string; validatesSubset?: boolean };
  /**
   * How this entity's fields sit in its route's request body:
   *   "object"              — the body IS this object (the default)
   *   "array"               — the body is a bare array of these rows, and the
   *                           write REPLACES the whole set
   *   { wrappedIn: "key" }  — the body is `{ key: [ ...these rows ] }`
   *
   * Forge cannot construct a valid request without this: three of the routes
   * here take a bare array and several more take a single wrapper key.
   */
  payloadShape?: "object" | "array" | { wrappedIn: string };
  /**
   * Set when this entity has no route of its own and its rows travel inside
   * another entity's payload, under `key`. `createSchema` then names the
   * PARENT's schema, because that is what validates these rows.
   */
  nestedIn?: { entity: string; key: string };
  /** Shared write core both the route and any Forge tool must go through. */
  writeCore?: string;
  /**
   * True when rows belong to a scenario; false when the table has no scenario
   * column and a single write is visible from every scenario.
   *
   * True does NOT always mean "the write lands on the base case". Most of these
   * routes resolve the base case themselves and ignore the open scenario, but a
   * few (`gift_series`, `account_flow_override`) take an explicit scenario
   * query param and write there instead. The distinction decides whether a
   * write the advisor approves shows up in their plan or only inside one
   * scenario, so check the entity's own notes before writing.
   */
  scenarioScoped: boolean;
  /** Forge tool that already writes this, if one exists. */
  forgeTool?: { add?: string; update?: string; remove?: string };
  /**
   * Fields that identify this row when matching an extracted candidate against
   * the client's existing rows. Absent means create-only: the matcher reports
   * "new" every time and the review table says so.
   *
   * The nine entities with a hand-written matcher in
   * `src/lib/imports/match-keys/` do NOT need this — those encode domain
   * judgement (the account matcher's weighted ladder, life insurance's
   * face-value tolerance) that a generic key cannot express.
   */
  identity?: readonly string[];

  /**
   * True when a document can state this entity. This is the region
   * classifier's whole vocabulary.
   *
   * Absent for every derived or structural entity — schedule overrides, flow
   * overrides, extra-payment rows — and for every Techniques, Assumptions and
   * Observations entity. No document states a withdrawal strategy or a target
   * probability of success; those are the advisor's choices.
   */
  documentEvidence?: true;

  /**
   * What a document carrying this entity looks like, in the words a document
   * actually prints. Fed to the region classifier so it has something concrete
   * to recognise rather than an entity id.
   */
  documentHints?: readonly string[];

  /**
   * How this entity's table reaches a client. Task 13's generic row loader
   * refuses to read a table whose path is not declared here — fail closed,
   * never an unscoped read.
   *
   * It cannot be inferred, and the two Phase 2 build targets disagree:
   * `disabilityPolicies` carries `clientId` on the row, while
   * `lifeInsurancePolicies` has none — it hangs off `accountId` and must be
   * joined through `accounts`. A loader that assumed `table.clientId` would
   * return every firm's policies: a cross-tenant leak, not an error.
   */
  scopePath?:
    | { via: "column" }
    | { via: "join"; through: string; on: string };
  fields: readonly DetailField[];
}
