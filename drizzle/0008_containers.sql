CREATE TYPE "public"."container_direction" AS ENUM('inward', 'outward');--> statement-breakpoint
CREATE TYPE "public"."container_status" AS ENUM('in_transit', 'at_port', 'cleared', 'received', 'packing', 'dispatched', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cost_allocation_basis" AS ENUM('value', 'quantity', 'weight', 'volume');--> statement-breakpoint
CREATE TABLE "container_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"payee_supplier_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"exchange_rate" numeric(14, 6) DEFAULT '1' NOT NULL,
	"amount_aed" numeric(14, 2) NOT NULL,
	"vat_aed" numeric(14, 2) DEFAULT '0' NOT NULL,
	"allocation" "cost_allocation_basis" DEFAULT 'value' NOT NULL,
	"in_landed_cost" boolean DEFAULT true NOT NULL,
	"incurred_on" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"entered_as" text,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"lot_no" text,
	"expiry_date" date,
	"serials" jsonb,
	"weight_kg" numeric(14, 3) DEFAULT '0' NOT NULL,
	"volume_cbm" numeric(14, 3) DEFAULT '0' NOT NULL,
	"hs_code" text,
	"landed_unit_cost_aed" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"direction" "container_direction" NOT NULL,
	"container_no" text NOT NULL,
	"seal_no" text,
	"size" text DEFAULT '40HC' NOT NULL,
	"shipping_line" text,
	"vessel" text,
	"voyage" text,
	"bill_of_lading" text,
	"supplier_id" uuid,
	"customer_id" uuid,
	"incoterm" text,
	"origin_country" text,
	"load_port" text,
	"discharge_port" text,
	"warehouse_id" uuid,
	"eta" date,
	"arrival_date" date,
	"dispatch_date" date,
	"customs_declaration_no" text,
	"free_zone" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"exchange_rate" numeric(14, 6) DEFAULT '1' NOT NULL,
	"status" "container_status" NOT NULL,
	"stock_posted_at" timestamp with time zone,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "containers_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"country" text,
	"tax_id" text,
	"credit_days" integer DEFAULT 30 NOT NULL,
	"credit_limit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"country" text,
	"tax_id" text,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "container_costs" ADD CONSTRAINT "container_costs_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_costs" ADD CONSTRAINT "container_costs_payee_supplier_id_suppliers_id_fk" FOREIGN KEY ("payee_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_costs" ADD CONSTRAINT "container_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_items" ADD CONSTRAINT "container_items_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_items" ADD CONSTRAINT "container_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "container_costs_container_idx" ON "container_costs" USING btree ("container_id");--> statement-breakpoint
CREATE INDEX "container_items_container_idx" ON "container_items" USING btree ("container_id");--> statement-breakpoint
CREATE INDEX "containers_no_idx" ON "containers" USING btree ("container_no");--> statement-breakpoint
CREATE INDEX "containers_status_idx" ON "containers" USING btree ("direction","status");--> statement-breakpoint
CREATE INDEX "containers_supplier_idx" ON "containers" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "containers_customer_idx" ON "containers" USING btree ("customer_id");