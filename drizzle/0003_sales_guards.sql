ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_chk CHECK (qty > 0 AND unit_price >= 0 AND vat_rate >= 0);
--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_chk CHECK (qty > 0 AND unit_price >= 0);
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_chk CHECK (paid_amount >= 0 AND paid_amount <= total AND total >= 0);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_amount_chk CHECK (amount > 0);
--> statement-breakpoint
-- An issued tax invoice is immutable: only paid_amount may change; it can never be deleted.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A tax invoice cannot be deleted'; END IF;
  IF NEW.number <> OLD.number OR NEW.sale_id <> OLD.sale_id OR NEW.customer_id <> OLD.customer_id OR NEW.issue_date <> OLD.issue_date OR NEW.due_date <> OLD.due_date
     OR NEW.subtotal <> OLD.subtotal OR NEW.vat_total <> OLD.vat_total OR NEW.total <> OLD.total OR NEW.parties IS DISTINCT FROM OLD.parties THEN
    RAISE EXCEPTION 'An issued tax invoice is immutable; only payments can change it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_guard_trg BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invoice_lines_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Lines of an issued tax invoice cannot change'; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_immutable_trg BEFORE UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payments_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'payments are append-only'; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_no_update_delete BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_immutable();
