-- Flags on entities that control how out-of-estate ownership affects the household projection.
-- include_in_portfolio: when true, the entity's accounts are rolled into household portfolio assets on the cash-flow view.
-- is_grantor: when true, taxes on the entity's income and RMDs are paid at the household level (grantor trust).
ALTER TABLE "entities" ADD COLUMN "include_in_portfolio" boolean NOT NULL DEFAULT false;
ALTER TABLE "entities" ADD COLUMN "is_grantor" boolean NOT NULL DEFAULT false;
