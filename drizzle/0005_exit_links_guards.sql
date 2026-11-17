ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_exit_fk FOREIGN KEY (exit_bill_id) REFERENCES exit_bills(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_exit_fk FOREIGN KEY (exit_bill_id) REFERENCES exit_bills(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE bill_allocations ADD CONSTRAINT bill_allocations_chk CHECK (packages > 0 AND weight_kg >= 0);
--> statement-breakpoint
ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_net_chk CHECK (net_override IS NULL OR net_override >= 0);
