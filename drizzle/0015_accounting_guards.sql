ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_amount_chk CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0) AND (debit > 0 OR credit > 0));
--> statement-breakpoint
ALTER TABLE payables ADD CONSTRAINT payables_amount_chk CHECK (amount_aed > 0 AND paid_aed >= 0 AND paid_aed <= amount_aed);
--> statement-breakpoint
ALTER TABLE payable_payments ADD CONSTRAINT payable_payments_chk CHECK (amount_aed > 0);
--> statement-breakpoint
-- Every journal entry must balance (checked at commit, once all its lines are in).
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN RAISE EXCEPTION 'Journal entry is not balanced: debits % <> credits %', d, c; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
--> statement-breakpoint
-- The ledger is append-only.
CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'The ledger is append-only: post a reversing entry instead'; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
--> statement-breakpoint
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
--> statement-breakpoint
-- No postings into a closed period.
CREATE OR REPLACE FUNCTION journal_period_lock() RETURNS trigger AS $$
DECLARE locked date;
BEGIN
  SELECT books_locked_through INTO locked FROM company_settings WHERE id = 1;
  IF locked IS NOT NULL AND NEW.entry_date <= locked THEN
    RAISE EXCEPTION 'Books are locked through %; cannot post on %', locked, NEW.entry_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER journal_entries_period_lock BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_period_lock();
--> statement-breakpoint
-- UAE default chart of accounts (accrual basis, VAT, AED).
INSERT INTO accounts (code, name, type, is_system, is_cash) VALUES
 ('1000','Cash on hand','asset',true,true),
 ('1010','Bank - operating account','asset',true,true),
 ('1200','Accounts receivable','asset',true,false),
 ('1300','Inventory','asset',true,false),
 ('1400','VAT input (recoverable)','asset',true,false),
 ('1500','Prepayments & deposits','asset',false,false),
 ('1600','Fixed assets','asset',false,false),
 ('2100','Accounts payable','liability',true,false),
 ('2200','Accrued expenses','liability',false,false),
 ('2300','VAT output (payable to FTA)','liability',true,false),
 ('2400','Salaries payable','liability',true,false),
 ('2410','Payroll deductions payable','liability',true,false),
 ('2500','End-of-service gratuity provision','liability',false,false),
 ('3000','Share capital / owner''s equity','equity',true,false),
 ('3100','Retained earnings','equity',true,false),
 ('4000','Sales - local (standard rated)','income',true,false),
 ('4010','Sales - exports (zero rated)','income',true,false),
 ('4020','Other income','income',false,false),
 ('5000','Cost of goods sold','expense',true,false),
 ('5100','Freight & shipping','expense',true,false),
 ('5110','Customs duty','expense',true,false),
 ('5120','Cargo insurance','expense',true,false),
 ('5130','Port & terminal charges','expense',true,false),
 ('5140','Clearing & delivery order fees','expense',true,false),
 ('5150','Local transport','expense',true,false),
 ('5160','Labour & handling','expense',true,false),
 ('5190','Other direct costs','expense',true,false),
 ('6000','Salaries & wages','expense',true,false),
 ('6100','Rent & utilities','expense',false,false),
 ('6900','Other operating expenses','expense',false,false),
 ('7000','Exchange gain / loss','expense',false,false)
ON CONFLICT (code) DO NOTHING;
