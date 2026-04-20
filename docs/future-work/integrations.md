# Future Work — Integrations

- ~~**AI statement import in Client Data**~~ — **SHIPPED.** Import tab in
  client-data with drag-and-drop upload, Azure OpenAI extraction for 6
  document types, step-by-step review wizard, and batch commit with
  `source: "extracted"`.

- **Asset allocation extraction from statements** _(P6 E4 L5)_ — extend
  the AI statement import pipeline to detect and extract asset allocation
  data when available in uploaded statements (e.g., brokerage summaries,
  quarterly reports). The extractor maps each holding or asset class to
  the closest matching asset class in the system's CMAs, producing a
  draft allocation the advisor reviews before saving. Feeds directly
  into the per-account asset mix tab (see Client Data section) and the
  Investments report. _Why deferred: statement import works for balances
  and holdings; allocation mapping requires CMA-aware matching logic and
  advisor review UX._

- **Cloud storage linking for imported documents** _(P3 E5 L3)_ — connect
  advisor's cloud storage (Google Drive, Dropbox, OneDrive) to persist uploaded
  source documents alongside extracted data. Enables audit trail, re-extraction
  with improved prompts, and advisor document management. _Why deferred:
  extraction works fine with in-memory processing; storage adds auth complexity
  (OAuth per provider) and infrastructure cost._

- **Plaid account linking** _(P3 E3 L5)_ — live balance + transaction feed
  for linked client accounts. Operationally heavy (token storage, webhooks,
  reauth, dedup, per-item cost). _Why deferred: AI statement import gives
  most of the value at a fraction of the cost; revisit after that ships._
