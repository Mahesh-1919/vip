-- Stock can never go negative, whatever the application code does.
ALTER TABLE stock_levels ADD CONSTRAINT stock_levels_qty_nonneg CHECK (qty >= 0);
--> statement-breakpoint
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_qty_nonzero CHECK (qty <> 0);
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_reorder_nonneg CHECK (reorder_level >= 0 AND avg_cost >= 0);
--> statement-breakpoint
ALTER TABLE product_packagings ADD CONSTRAINT packaging_qty_pos CHECK (qty > 0);
--> statement-breakpoint
-- The movement ledger is append-only.
CREATE OR REPLACE FUNCTION stock_moves_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_moves is append-only: post a reversing move instead';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_moves_no_update_delete BEFORE UPDATE OR DELETE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION stock_moves_immutable();
--> statement-breakpoint
CREATE TRIGGER stock_moves_no_truncate BEFORE TRUNCATE ON stock_moves
  FOR EACH STATEMENT EXECUTE FUNCTION stock_moves_immutable();
