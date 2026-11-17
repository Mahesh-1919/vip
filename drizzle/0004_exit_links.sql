CREATE TABLE "bill_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exit_bill_id" uuid NOT NULL,
	"entry_bill_id" uuid NOT NULL,
	"packages" integer NOT NULL,
	"weight_kg" numeric(14, 2) DEFAULT '0' NOT NULL,
	"over_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ALTER COLUMN "unit_price" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "unit_price" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "exit_bills" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "exit_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "exit_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "net_override" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_exit_bill_id_exit_bills_id_fk" FOREIGN KEY ("exit_bill_id") REFERENCES "public"."exit_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_entry_bill_id_entry_bills_id_fk" FOREIGN KEY ("entry_bill_id") REFERENCES "public"."entry_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alloc_pair_uq" ON "bill_allocations" USING btree ("exit_bill_id","entry_bill_id");--> statement-breakpoint
CREATE INDEX "alloc_entry_idx" ON "bill_allocations" USING btree ("entry_bill_id");--> statement-breakpoint
ALTER TABLE "exit_bills" ADD CONSTRAINT "exit_bills_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_exit_idx" ON "invoice_lines" USING btree ("exit_bill_id");--> statement-breakpoint
CREATE INDEX "sale_lines_exit_idx" ON "sale_lines" USING btree ("exit_bill_id");