-- Payroll lock. Finalised runs and their items are immutable at the database level.
-- Admin "reopen" sets a transaction-local flag (SET LOCAL erp.allow_reopen = 'on') to bypass.
CREATE OR REPLACE FUNCTION payroll_runs_guard() RETURNS trigger AS $$
BEGIN
  IF current_setting('erp.allow_reopen', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Cannot delete a % payroll run', OLD.status; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  -- finalized -> paid is the only allowed change after finalisation
  IF OLD.status = 'finalized' AND NEW.status = 'paid'
     AND NEW.total_gross = OLD.total_gross AND NEW.total_net = OLD.total_net AND NEW.total_deductions = OLD.total_deductions
     AND NEW.year = OLD.year AND NEW.month = OLD.month THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Payroll run is % and locked', OLD.status;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_runs_guard_trg BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payroll_children_guard() RETURNS trigger AS $$
DECLARE run_status payroll_status; rid uuid;
BEGIN
  IF current_setting('erp.allow_reopen', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  rid := COALESCE(NEW.run_id, OLD.run_id);
  SELECT status INTO run_status FROM payroll_runs WHERE id = rid;
  IF run_status IS NOT NULL AND run_status <> 'draft' THEN
    RAISE EXCEPTION 'Payroll run is % and locked', run_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_items_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON payroll_items
  FOR EACH ROW EXECUTE FUNCTION payroll_children_guard();
--> statement-breakpoint
CREATE TRIGGER payroll_adj_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION payroll_children_guard();
--> statement-breakpoint
ALTER TABLE payroll_settings ADD CONSTRAINT payroll_settings_single CHECK (id = 1);
--> statement-breakpoint
INSERT INTO payroll_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
