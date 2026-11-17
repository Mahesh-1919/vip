ALTER TABLE company_settings ADD CONSTRAINT company_settings_single CHECK (id = 1);
--> statement-breakpoint
ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_chk CHECK (qty > 0 AND unit_price >= 0 AND vat_rate >= 0);
--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_chk CHECK (qty > 0 AND unit_price >= 0);
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_chk CHECK (paid_amount >= 0 AND paid_amount <= total AND total >= 0);
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_number_chk CHECK ((status = 'issued') = (number IS NOT NULL));
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_amount_chk CHECK (amount <> 0);
--> statement-breakpoint
-- Issued invoices are immutable: only paid_amount (and version) may change.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'An issued tax invoice cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.status <> OLD.status OR NEW.customer_id <> OLD.customer_id OR NEW.sale_id <> OLD.sale_id
     OR NEW.issue_date <> OLD.issue_date OR NEW.supply_date <> OLD.supply_date OR NEW.due_date <> OLD.due_date OR NEW.currency <> OLD.currency
     OR NEW.exchange_rate <> OLD.exchange_rate OR NEW.subtotal <> OLD.subtotal OR NEW.vat_total <> OLD.vat_total OR NEW.total <> OLD.total
     OR NEW.total_aed <> OLD.total_aed OR NEW.vat_aed <> OLD.vat_aed OR NEW.parties IS DISTINCT FROM OLD.parties THEN
    RAISE EXCEPTION 'An issued tax invoice is immutable; only payments can change it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_guard_trg BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invoice_lines_guard() RETURNS trigger AS $$
DECLARE st invoice_status; iid uuid;
BEGIN
  iid := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT status INTO st FROM invoices WHERE id = iid;
  IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'Lines of an issued tax invoice cannot change'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payments_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'payments are append-only: post a reversal instead'; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_no_update_delete BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_immutable();
