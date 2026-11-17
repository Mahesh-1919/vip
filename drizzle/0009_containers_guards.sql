ALTER TABLE containers ADD CONSTRAINT containers_party_chk CHECK (
  (direction = 'inward' AND customer_id IS NULL) OR (direction = 'outward' AND supplier_id IS NULL)
);
--> statement-breakpoint
ALTER TABLE containers ADD CONSTRAINT containers_status_chk CHECK (
  (direction = 'inward' AND status IN ('in_transit','at_port','cleared','received','cancelled'))
  OR (direction = 'outward' AND status IN ('packing','dispatched','shipped','delivered','cancelled'))
);
--> statement-breakpoint
ALTER TABLE containers ADD CONSTRAINT containers_rate_chk CHECK (exchange_rate > 0);
--> statement-breakpoint
ALTER TABLE container_items ADD CONSTRAINT container_items_qty_chk CHECK (qty > 0 AND unit_price >= 0 AND weight_kg >= 0 AND volume_cbm >= 0);
--> statement-breakpoint
ALTER TABLE container_costs ADD CONSTRAINT container_costs_amt_chk CHECK (amount > 0 AND exchange_rate > 0 AND amount_aed > 0 AND vat_aed >= 0);
--> statement-breakpoint
-- Once stock is posted, the item list is frozen at the database level.
CREATE OR REPLACE FUNCTION container_items_lock() RETURNS trigger AS $$
DECLARE posted timestamptz; cid uuid;
BEGIN
  cid := COALESCE(NEW.container_id, OLD.container_id);
  SELECT stock_posted_at INTO posted FROM containers WHERE id = cid;
  IF posted IS NOT NULL AND NOT (TG_OP = 'UPDATE' AND OLD.landed_unit_cost_aed IS NULL AND NEW.landed_unit_cost_aed IS NOT NULL
        AND NEW.qty = OLD.qty AND NEW.product_id = OLD.product_id) THEN
    RAISE EXCEPTION 'Container stock is already posted; items are locked';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER container_items_lock_trg BEFORE INSERT OR UPDATE OR DELETE ON container_items
  FOR EACH ROW EXECUTE FUNCTION container_items_lock();
