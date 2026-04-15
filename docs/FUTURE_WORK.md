# Future Work

Lightweight running list of items deferred from past sessions. Add a new entry
when you consciously scope something out; remove the entry when it ships.
Format: one line per item plus a short "Why deferred" note.

## UI

- **Out-of-estate liabilities section on balance sheet** — accounts get an amber
  "Out of Estate" panel grouped by entity; liabilities are persisted with
  `owner_entity_id` and accepted by the form, but still display in the main
  Liabilities list. _Why deferred: not yet requested; wanted the assets version
  in front of the user first._

- **Dedicated entity balance sheets** — an entity's accounts and liabilities
  currently show up inside the household balance sheet (OOE section). Long
  term it may be cleaner to give each entity its own balance-sheet view. _Why
  deferred: current display is acceptable for single-entity cases._

- **Scenario switcher** — the schema supports multiple scenarios per client but
  the UI always operates on the base case. _Why deferred: scenarios aren't a
  user-facing feature yet._

- **Family members as owners** — `family_members` rows are informational only
  today. Children/grandchildren can't own accounts, incomes, or expenses. _Why
  deferred: not yet requested; entity ownership covers the main trust use
  case._

## Engine

- **Non-grantor entity-level taxes** — when an entity is not flagged
  `is_grantor`, household taxes are correctly skipped but the entity itself
  owes tax on its income and RMDs. That tax isn't modeled; the entity's
  checking grows as if pre-tax. _Why deferred: no flat entity tax rate field
  exists yet and the common case is grantor trusts._

- **Entity withdrawal strategy** — when an entity's checking goes negative,
  the engine leaves it negative instead of pulling from the entity's own
  retirement/taxable accounts. _Why deferred: adds per-entity withdrawal-order
  configuration; wait for a real case that needs it._

- **Employer match when using legacy cash-flow path** — the match amount is
  computed but never credited to the account in the no-default-checking
  branch. _Why deferred: every real client now has a default checking; legacy
  path exists only for fixtures and pre-migration data._

## Schema

- **Per-entity tax rate / election fields** — needed before we can model
  non-grantor entity taxes. _Why deferred: see above._

## Tooling

- **Scheduled / automated migrations in CI** — migrations are applied
  manually via `drizzle-kit migrate` against the Neon URL in `.env.local`.
  _Why deferred: single dev, single environment for now._
