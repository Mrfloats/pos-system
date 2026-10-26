-- Rules the general ledger keeps even if the API has a bug.

-- 1. Append-only: the API can add journal entries but never change or remove them.
--    Mistakes are undone with a reversing entry.
REVOKE UPDATE, DELETE ON journal_entries FROM pos_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON journal_lines FROM pos_app;--> statement-breakpoint

-- 2. Every entry balances: total debits = total credits, checked when the transaction commits.
CREATE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d numeric;
  c numeric;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO d, c
  FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'Journal entry does not balance (debits %, credits %)', d, c
      USING ERRCODE = '23514', CONSTRAINT = 'journal_entry_balanced';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();--> statement-breakpoint

-- 3. Closed periods: nothing can be posted on or before the tenant's close date.
CREATE FUNCTION journal_entry_open_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  closed date;
BEGIN
  SELECT books_closed_through INTO closed FROM tenants WHERE id = NEW.tenant_id;
  IF closed IS NOT NULL AND NEW.date <= closed THEN
    RAISE EXCEPTION 'The books are closed up to %', closed
      USING ERRCODE = '23514', CONSTRAINT = 'journal_entry_open_period';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER journal_entries_open_period
  BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entry_open_period();
