-- Audit log is append-only: block UPDATE and DELETE for every role (including the app role).
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_holiday_calendar_fk" FOREIGN KEY ("holiday_calendar_id") REFERENCES "holiday_calendars"("id");
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_req_dates_chk" CHECK ("to_date" >= "from_date" AND "days" > 0);
--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_bal_used_chk" CHECK ("used" >= 0);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_single" CHECK (id = 1);
--> statement-breakpoint
INSERT INTO company_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "entry_bills" ADD CONSTRAINT "entry_bills_chk" CHECK (value_aed >= 0 AND weight_kg >= 0 AND packages >= 0);
--> statement-breakpoint
ALTER TABLE "exit_bills" ADD CONSTRAINT "exit_bills_chk" CHECK (value_aed >= 0 AND weight_kg >= 0 AND packages >= 0 AND bill_type IN ('IMPORT','EXPORT'));
--> statement-breakpoint
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
