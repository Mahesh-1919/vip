-- Move the company name/address from payroll settings into the shared company profile.
INSERT INTO company_settings (id, name, address)
  SELECT 1, company_name, company_address FROM payroll_settings WHERE id = 1
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address;
--> statement-breakpoint
INSERT INTO company_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
